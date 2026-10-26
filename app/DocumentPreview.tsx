import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { renderAsync } from 'docx-preview';
import DOMPurify from 'dompurify';
import JSZip from 'jszip';
import { marked } from 'marked';
import { FileText, LoaderCircle } from 'lucide-react';
import type { Asset, CanvasObject, ExtensionInfo } from './types';
import ExtensionFrame from './ExtensionFrame';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const frameCsp = "default-src 'none'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; script-src 'none'; connect-src 'none'; base-uri 'none'";
const htmlDocument = (body: string, styles = '') => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${frameCsp}"><style>html,body{margin:0;padding:8px;font:13px/1.45 system-ui,sans-serif;color:#253454;background:white}a{color:#285fc0;text-decoration:underline}table{border-collapse:collapse}td,th{border:1px solid #dce3ee;padding:3px 6px}img{max-width:100%}</style>${styles}</head><body>${body}</body></html>`;

export default function DocumentPreview({ object, asset, viewer, interactive, onContentSize, onError }: { object: CanvasObject; asset?: Asset; viewer?: { extension: ExtensionInfo; entry: string }; interactive: boolean; onContentSize?(size: { width: number; height: number }): void; onError(error: unknown): void }) {
  const format = (object.payload as { format: string }).format;
  const assetId = (object.payload as { assetId: string }).assetId;
  const printout = (object.payload as { presentation?: string }).presentation === 'printout';
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [pdfPages, setPdfPages] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null);
  const file = useMemo(() => bytes ? { data: bytes } : null, [bytes]);

  useEffect(() => {
    let live = true;
    window.whiteboard.readAsset(assetId).then((data) => { if (live) setBytes(new Uint8Array(data)); }).catch((reason) => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, [assetId]);

  useEffect(() => {
    if (!bytes || format === 'pdf' || viewer) return;
    let live = true;
    const run = async () => {
      try {
        let content: string;
        if (format === 'docx') content = await renderDocx(bytes, printout);
        else if (format === 'xlsx') content = await renderXlsx(bytes);
        else if (format === 'pptx') content = await renderPptx(bytes);
        else if (['txt','md','markdown','html','htm'].includes(format)) {
          const source = new TextDecoder().decode(bytes);
          content = format === 'txt' ? htmlDocument(`<pre>${escapeHtml(source)}</pre>`) : format === 'md' || format === 'markdown' ? htmlDocument(DOMPurify.sanitize(await marked.parse(source))) : htmlDocument(DOMPurify.sanitize(source));
        } else content = htmlDocument('<p>No in-canvas viewer is installed for this file type. Use <strong>Open original</strong>.</p>');
        if (live) setHtml(content);
      } catch (reason) { if (live) setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    run();
    return () => { live = false; };
  }, [bytes, format, viewer, printout]);

  useEffect(() => {
    if (!interactive || !html || !iframe.current) return;
    const frame = iframe.current;
    const wire = () => {
      const document = frame.contentDocument;
      if (!document) return;
      document.addEventListener('click', (event) => {
        const anchor = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = anchor.getAttribute('href') || '';
        if (href.startsWith('#')) return; // Native bookmark/TOC jump inside the frame.
        event.preventDefault();
        window.whiteboard.openExternal(href).catch(onError);
      });
    };
    frame.addEventListener('load', wire);
    if (frame.contentDocument?.readyState === 'complete') wire();
    return () => frame.removeEventListener('load', wire);
  }, [html, interactive, onError]);

  if (error) return <div className="document-body"><div className="document-error"><FileText size={22} /><p>{error}</p><span>Open original from the attachment menu.</span></div></div>;
  if (viewer) return <div className={`document-body ${printout ? 'document-printout' : ''}`} onPointerDown={(event) => { if (interactive) event.stopPropagation(); }}><ExtensionFrame extension={viewer.extension} entry={viewer.entry} kind="document" data={{ name: asset?.original_name, format }} bytes={bytes} interactive={interactive} onError={onError} /></div>;
  return <div className={`document-body ${printout ? 'document-printout' : ''}`} onPointerDown={(event) => { if (interactive) event.stopPropagation(); }}>
    <div className="document-content">
      {format === 'pdf' && file ? <div className="pdf-content" onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = anchor.getAttribute('href') || '';
        if (/^https?:|^mailto:/i.test(href)) { event.preventDefault(); event.stopPropagation(); window.whiteboard.openExternal(href).catch(onError); }
      }}><Document file={file} suspense={false} onLoadSuccess={(pdf) => setPdfPages(pdf.numPages)} onLoadError={(reason) => setError(reason.message)} loading={<Loading />}>{Array.from({ length: Math.min(pdfPages, 50) }, (_, index) => <Page key={index} pageNumber={index + 1} width={Math.max(200, object.width - (printout ? 24 : 32))} renderTextLayer={!printout || interactive} renderAnnotationLayer={!printout || interactive} suspense={false} />)}</Document>{pdfPages > 50 && <p>First 50 pages shown. Open original for the rest.</p>}</div> : error ? <div className="document-error"><FileText size={22} /><p>{error}</p><span>Open original from the attachment menu.</span></div> : format === 'pdf' ? <Loading /> : html ? <iframe ref={iframe} title={`${format} preview`} srcDoc={html} sandbox="allow-same-origin" onLoad={() => { if (printout && format === 'docx') requestAnimationFrame(() => { const frame = iframe.current?.contentDocument; const wrapper = frame?.querySelector('.docx-wrapper'); const sheet = wrapper?.querySelector('section'); if (frame) onContentSize?.({ width: Math.max(200, Math.ceil(sheet?.getBoundingClientRect().width || frame.body.scrollWidth) + 16), height: Math.max(150, (wrapper?.scrollHeight || frame.body.scrollHeight) + 16) }); }); }} /> : <Loading />}
      {!interactive && <div className="document-shield" aria-hidden="true" />}
    </div>
  </div>;
}

function Loading() { return <div className="document-loading"><LoaderCircle size={19} className="spin" /> Loading preview…</div>; }

async function renderDocx(bytes: Uint8Array, printout = false) {
  const body = document.createElement('div');
  const styles = document.createElement('div');
  await renderAsync(new Blob([new Uint8Array(bytes)]), body, styles, { breakPages: true, useBase64URL: true });
  // The DOCX renderer owns preview markup only; no script is allowed in the iframe.
  const cleanBody = DOMPurify.sanitize(body.innerHTML, { ADD_ATTR: ['style'] });
  const cleanStyles = [...styles.querySelectorAll('style')].map((element) => `<style>${element.textContent?.replaceAll('</style', '') ?? ''}</style>`).join('');
  const printoutStyle = printout ? '<style>.docx-wrapper{background:#fff!important;padding:0!important}.docx-wrapper>section{margin:0 auto 12px!important;box-shadow:0 2px 8px #2235501a!important}</style>' : '';
  return htmlDocument(cleanBody, cleanStyles + printoutStyle);
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
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const html: string[] = [];
  for (let index = 0; index < Math.min(slides.length, 80); index++) {
    const slidePath = slides[index];
    const xml = new DOMParser().parseFromString(await zip.file(slidePath)!.async('text'), 'application/xml');
    const relPath = slidePath.replace('/slide', '/_rels/slide') + '.rels';
    const relXml = zip.file(relPath) ? new DOMParser().parseFromString(await zip.file(relPath)!.async('text'), 'application/xml') : null;
    const relations = new Map<string, string>();
    relXml?.querySelectorAll('Relationship').forEach((element) => relations.set(element.getAttribute('Id') || '', element.getAttribute('Target') || ''));
    const blocks: string[] = [];
    xml.getElementsByTagName('p:sp').length;
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
