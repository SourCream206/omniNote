import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import DOMPurify from 'dompurify';
import { LoaderCircle } from 'lucide-react';
import type { Asset, Camera, CanvasObject, ExtensionInfo } from './types';
import ExtensionFrame from './ExtensionFrame';
import { pdfPrintoutHeight, visiblePdfPages } from './pdfVisibility';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
type PdfLayoutSource = { numPages: number; getPage(pageNumber: number): Promise<{ getViewport(options: { scale: number }): { width: number; height: number } }> };
const ratioCache = new Map<string, Promise<number[]>>();
function pageRatios(assetId: string, pdf: PdfLayoutSource): Promise<number[]> {
  const cached = ratioCache.get(assetId);
  if (cached) return cached;
  const pending = (async () => {
    const ratios: number[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const size = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 });
      ratios.push(size.height / size.width);
    }
    return ratios;
  })();
  ratioCache.set(assetId, pending);
  if (ratioCache.size > 8) ratioCache.delete(ratioCache.keys().next().value!);
  pending.catch(() => ratioCache.delete(assetId));
  return pending;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const frameCsp = "default-src 'none'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; script-src 'none'; connect-src 'none'; base-uri 'none'";
const htmlDocument = (body: string, styles = '') => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${frameCsp}"><style>html,body{margin:0;padding:8px;font:13px/1.45 system-ui,sans-serif;color:#253454;background:white}a{color:#285fc0;text-decoration:underline}table{border-collapse:collapse}td,th{border:1px solid #dce3ee;padding:3px 6px}img{max-width:100%}</style>${styles}</head><body>${body}</body></html>`;

export default function DocumentPreview({ object, asset, viewer, interactive, fullDocument = false, camera, onContentSize, onPreviewFailure, onError }: { object: CanvasObject; asset?: Asset; viewer?: { extension: ExtensionInfo; entry: string }; interactive: boolean; fullDocument?: boolean; camera?: Camera; onContentSize?(size: { width: number; height: number }): void; onPreviewFailure(): void; onError(error: unknown): void }) {
  const format = (object.payload as { format: string }).format;
  const assetId = (object.payload as { assetId: string }).assetId;
  const printout = (object.payload as { presentation?: string }).presentation === 'printout';
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [pdfPages, setPdfPages] = useState(0);
  const [ratios, setRatios] = useState<number[]>([]);
  const pdfHost = useRef<HTMLDivElement>(null);
  const pdfDocument = useRef<PdfLayoutSource | null>(null);
  const pageSlots = useRef<HTMLElement[]>([]);
  const visibilityFrame = useRef<number | null>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([1, 2]));
  const iframe = useRef<HTMLIFrameElement>(null);
  const file = useMemo(() => bytes ? { data: bytes } : null, [bytes]);
  const onContentSizeRef = useRef(onContentSize);
  onContentSizeRef.current = onContentSize;

  const updateVisiblePages = useCallback(() => {
    if (visibilityFrame.current !== null) return;
    visibilityFrame.current = requestAnimationFrame(() => {
      visibilityFrame.current = null;
      const container = pdfHost.current;
      if (!container) return;
      const viewport = printout ? container.closest('.canvas-viewport') : container.parentElement;
      const outer = viewport?.getBoundingClientRect();
      const inner = container.getBoundingClientRect();
      const top = Math.max(inner.top, outer?.top ?? inner.top) - 900;
      const bottom = Math.min(inner.bottom, outer?.bottom ?? inner.bottom) + 900;
      if (pageSlots.current.length !== pdfPages) pageSlots.current = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page-slot'));
      const next = visiblePdfPages(pageSlots.current, top, bottom);
      setVisiblePages((current) => current.size === next.size && [...next].every((page) => current.has(page)) ? current : next);
    });
  }, [pdfPages, printout]);

  const pdfPageElements = useMemo(() => Array.from({ length: pdfPages }, (_, index) =>
    <LazyPdfPage key={index} pageNumber={index + 1} width={Math.max(200, object.width - (printout ? 24 : 32))} initialRatio={ratios[index] ?? 1.3} printout={printout} interactive={interactive} visible={visiblePages.has(index + 1)} onSizeChange={updateVisiblePages} />
  ), [pdfPages, object.width, printout, ratios, interactive, visiblePages, updateVisiblePages]);

  useEffect(() => {
    if (pdfPages) updateVisiblePages();
    return () => { if (visibilityFrame.current !== null) cancelAnimationFrame(visibilityFrame.current); visibilityFrame.current = null; };
  }, [pdfPages, fullDocument, object.width, object.height, camera?.x, camera?.y, camera?.zoom, ratios]);

  useEffect(() => {
    if (!printout || !pdfPages || !pdfDocument.current) return;
    let live = true;
    pageRatios(assetId, pdfDocument.current).then((value) => { if (live) setRatios(value); }).catch((reason) => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, [assetId, pdfPages, printout]);

  useEffect(() => {
    if (printout && pdfPages) {
      const pageSizes = ratios.length === pdfPages ? ratios : Array(pdfPages).fill(1.3);
      onContentSizeRef.current?.({ width: object.width, height: pdfPrintoutHeight(object.width, pageSizes) });
    }
  }, [printout, ratios, pdfPages, object.width]);

  useEffect(() => {
    let live = true;
    pageSlots.current = [];
    pdfDocument.current = null;
    setPdfPages(0);
    setRatios([]);
    setBytes(null);
    window.whiteboard.readAsset(assetId).then((data) => { if (live) setBytes(new Uint8Array(data)); }).catch((reason) => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, [assetId]);

  useEffect(() => {
    if (!bytes || format === 'pdf' || viewer) return;
    let live = true;
    const run = async () => {
      try {
        let content: string;
        if (format === 'docx') content = await renderDocx(bytes, printout, fullDocument);
        else if (format === 'xlsx') content = await renderXlsx(bytes);
        else if (format === 'pptx') content = await renderPptx(bytes);
        else if (['txt','md','markdown','html','htm'].includes(format)) {
          const source = new TextDecoder().decode(bytes);
          content = format === 'txt' ? htmlDocument(`<pre>${escapeHtml(source)}</pre>`) : format === 'md' || format === 'markdown' ? htmlDocument(DOMPurify.sanitize(await (await import('marked')).marked.parse(source))) : htmlDocument(DOMPurify.sanitize(source));
        } else content = htmlDocument('<p>No in-canvas viewer is installed for this file type. Use <strong>Open original</strong>.</p>');
        if (live) setHtml(content);
      } catch (reason) { if (live) setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    run();
    return () => { live = false; };
  }, [bytes, format, viewer, printout, fullDocument]);

  useEffect(() => {
    if (!interactive || !html || !iframe.current) return;
    const frame = iframe.current;
    let wiredDocument: globalThis.Document | null = null;
    const openLink = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#')) return;
      event.preventDefault();
      window.whiteboard.openExternal(href).catch(onError);
    };
    const wire = () => {
      const document = frame.contentDocument;
      if (!document || wiredDocument === document) return;
      wiredDocument?.removeEventListener('click', openLink);
      document.addEventListener('click', openLink);
      wiredDocument = document;
    };
    frame.addEventListener('load', wire);
    if (frame.contentDocument?.readyState === 'complete') wire();
    return () => { frame.removeEventListener('load', wire); wiredDocument?.removeEventListener('click', openLink); };
  }, [html, interactive, onError]);

  useEffect(() => { if (error) onPreviewFailure(); }, [error, onPreviewFailure]);

  if (error) return null;
  if (viewer) return <div className={`document-body ${printout ? 'document-printout' : ''}`} onPointerDown={(event) => { if (interactive) event.stopPropagation(); }}><ExtensionFrame extension={viewer.extension} entry={viewer.entry} kind="document" data={{ name: asset?.original_name, format }} bytes={bytes} interactive={interactive} onError={onError} /></div>;
  return <div className={`document-body ${printout ? 'document-printout' : ''}`} onScrollCapture={updateVisiblePages} onPointerDown={(event) => { if (interactive) event.stopPropagation(); }}>
    <div className="document-content">
      {format === 'pdf' && file ? <div ref={pdfHost} className={`pdf-content ${fullDocument ? 'full-document' : ''}`} onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = anchor.getAttribute('href') || '';
        if (/^https?:|^mailto:/i.test(href)) { event.preventDefault(); event.stopPropagation(); window.whiteboard.openExternal(href).catch(onError); }
      }}><Document file={file} suspense={false} onLoadSuccess={(pdf) => { pdfDocument.current = pdf; setPdfPages(pdf.numPages); }} onLoadError={(reason) => setError(reason.message)} loading={<Loading />}>{pdfPageElements}</Document></div> : format === 'pdf' ? <Loading /> : html ? <iframe ref={iframe} title={`${format} preview`} srcDoc={html} sandbox="allow-same-origin" onLoad={() => { if (printout && format === 'docx') requestAnimationFrame(() => { const frame = iframe.current?.contentDocument; const wrapper = frame?.querySelector('.docx-wrapper'); const sheet = wrapper?.querySelector('section'); if (frame) onContentSize?.({ width: Math.max(200, Math.ceil(sheet?.getBoundingClientRect().width || frame.body.scrollWidth) + 16), height: Math.max(150, (wrapper?.scrollHeight || frame.body.scrollHeight) + 16) }); }); }} /> : <Loading />}
      {!interactive && <div className="document-shield" aria-hidden="true" />}
    </div>
  </div>;
}

function Loading() { return <div className="document-loading"><LoaderCircle size={19} className="spin" /> Loading preview…</div>; }

function LazyPdfPage({ pageNumber, width, initialRatio, printout, interactive, visible, onSizeChange }: { pageNumber: number; width: number; initialRatio: number; printout: boolean; interactive: boolean; visible: boolean; onSizeChange(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  return <div ref={host} className="pdf-page-slot" style={{ minHeight: Math.ceil(width * (aspectRatio ?? initialRatio)) }}>{visible && <Page pageNumber={pageNumber} width={width} renderTextLayer={!printout || interactive} renderAnnotationLayer={!printout || interactive} suspense={false} onRenderSuccess={() => {
    const pageHeight = (host.current?.querySelector('.react-pdf__Page') as HTMLElement | null)?.offsetHeight;
    if (pageHeight) { setAspectRatio(pageHeight / width); onSizeChange(); }
  }} />}</div>;
}

async function renderDocx(bytes: Uint8Array, printout = false, fullDocument = false) {
  const { renderAsync } = await import('docx-preview');
  const body = document.createElement('div');
  const styles = document.createElement('div');
  await renderAsync(new Blob([new Uint8Array(bytes)]), body, styles, { breakPages: true, useBase64URL: true });
  // The DOCX renderer owns preview markup only; no script is allowed in the iframe.
  const cleanBody = DOMPurify.sanitize(body.innerHTML, { ADD_ATTR: ['style'] });
  const cleanStyles = [...styles.querySelectorAll('style')].map((element) => `<style>${element.textContent?.replaceAll('</style', '') ?? ''}</style>`).join('');
  const printoutStyle = printout ? '<style>.docx-wrapper{background:#fff!important;padding:0!important}.docx-wrapper>section{box-sizing:border-box;min-width:760px!important;min-height:900px!important;padding:48px!important;margin:0 auto 12px!important;box-shadow:0 2px 8px #2235501a!important}</style>' : '';
  const fullStyle = fullDocument ? '<style>html,body{height:100%;padding:0}.docx-wrapper{min-height:100%;padding:18px!important}.docx-wrapper>section{box-sizing:border-box;width:min(760px,100%)!important;min-height:900px;margin:0 auto 16px!important;padding:48px!important;box-shadow:0 2px 10px #22355020!important}</style>' : '';
  return htmlDocument(cleanBody, cleanStyles + printoutStyle + fullStyle);
}

async function renderXlsx(bytes: Uint8Array) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheets = workbook.worksheets.map((sheet, index) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= 200) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (cells.length >= 30) return;
        const value = typeof cell.value === 'object' && cell.value !== null && 'text' in cell.value ? String(cell.value.text) : String(cell.text ?? '');
        const link = cell.hyperlink || (typeof cell.value === 'object' && cell.value !== null && 'hyperlink' in cell.value ? String(cell.value.hyperlink) : '');
        cells.push(`<td>${link ? `<a href="${escapeHtml(link)}">${escapeHtml(value)}</a>` : escapeHtml(value)}</td>`);
      });
      rows.push(`<tr><th>${row.number}</th>${cells.join('')}</tr>`);
    });
    return `<section id="sheet-${index + 1}"><h3>${escapeHtml(sheet.name)}</h3><table>${rows.join('')}</table></section>`;
  });
  const tabs = workbook.worksheets.map((sheet, index) => `<a href="#sheet-${index + 1}">${escapeHtml(sheet.name)}</a>`).join(' · ');
  return htmlDocument(`<nav>${tabs}</nav>${sheets.join('')}`);
}

async function renderPptx(bytes: Uint8Array) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const html: string[] = [];
  for (let index = 0; index < slides.length; index++) {
    const slidePath = slides[index];
    const xml = new DOMParser().parseFromString(await zip.file(slidePath)!.async('text'), 'application/xml');
    const relPath = slidePath.replace('/slide', '/_rels/slide') + '.rels';
    const relXml = zip.file(relPath) ? new DOMParser().parseFromString(await zip.file(relPath)!.async('text'), 'application/xml') : null;
    const relations = new Map<string, string>();
    relXml?.querySelectorAll('Relationship').forEach((element) => relations.set(element.getAttribute('Id') || '', element.getAttribute('Target') || ''));
    const blocks: string[] = [];
    for (const shape of Array.from(xml.getElementsByTagName('p:sp'))) {
      const runs: string[] = [];
      for (const run of Array.from(shape.getElementsByTagName('a:r'))) {
        const text = Array.from(run.getElementsByTagName('a:t')).map((node) => node.textContent || '').join('');
        const click = run.getElementsByTagName('a:hlinkClick')[0];
        const target = click ? relations.get(click.getAttribute('r:id') || '') : undefined;
        const href = target?.includes('slide') ? `#slide-${Number(target.match(/slide(\d+)/)?.[1] || 1)}` : target;
        runs.push(href ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : escapeHtml(text));
      }
      if (runs.length) blocks.push(`<p>${runs.join('')}</p>`);
    }
    html.push(`<section id="slide-${index + 1}" class="slide-preview"><small>SLIDE ${index + 1}</small>${blocks.join('') || '<p>Visual slide content is available in the original file.</p>'}</section>`);
  }
  return htmlDocument(html.join(''));
}
