import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function mountPdfLab() {
  const panel = document.querySelector<HTMLElement>('#pdf-panel')!;
  const scroll = document.querySelector<HTMLElement>('.pdf-scroll')!;
  const canvas = document.querySelector<HTMLCanvasElement>('#pdf-canvas')!;
  const status = document.querySelector<HTMLElement>('#pdf-status')!;
  const pageInput = document.querySelector<HTMLInputElement>('#pdf-page')!;
  const previous = document.querySelector<HTMLButtonElement>('#pdf-prev')!;
  const next = document.querySelector<HTMLButtonElement>('#pdf-next')!;
  let pdf: PDFDocumentProxy;
  let pageNumber = 1;
  let renderTask: RenderTask | null = null;
  let generation = 0;

  async function renderPage() {
    if (!pdf || panel.hidden) return;
    const current = ++generation;
    const previousTask = renderTask;
    renderTask = null;
    previousTask?.cancel();
    status.textContent = `Rendering page ${pageNumber}…`;
    pageInput.value = String(pageNumber);
    previous.disabled = pageNumber === 1;
    next.disabled = pageNumber === pdf.numPages;
    try {
      if (previousTask) { try { await previousTask.promise; } catch { /* cancelled render */ } }
      if (current !== generation) return;
      const page = await pdf.getPage(pageNumber);
      if (current !== generation) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, (scroll.clientWidth - 24) / natural.width);
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * dpr);
      canvas.height = Math.ceil(viewport.height * dpr);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      const context = canvas.getContext('2d')!;
      renderTask = page.render({ canvas, canvasContext: context, viewport,
        transform: [dpr, 0, 0, dpr, 0, 0] });
      await renderTask.promise;
      if (current === generation) status.textContent = '';
      page.cleanup();
    } catch (error) {
      if (current === generation && (error as Error).name !== 'RenderingCancelledException') {
        status.textContent = `Page render failed: ${(error as Error).message}`;
      }
    }
  }

  previous.addEventListener('click', () => { if (pdf && pageNumber > 1) { pageNumber--; void renderPage(); } });
  next.addEventListener('click', () => { if (pdf && pageNumber < pdf.numPages) { pageNumber++; void renderPage(); } });
  pageInput.addEventListener('change', () => {
    if (!pdf) return;
    pageNumber = Math.min(pdf.numPages, Math.max(1, Number(pageInput.value) || 1));
    void renderPage();
  });
  panel.addEventListener('pdf-panel-open', () => { void renderPage(); });
  new ResizeObserver(() => { if (!panel.hidden) void renderPage(); }).observe(scroll);

  try {
    pdf = await getDocument({ url: '/fixtures/300-pages.pdf', useSystemFonts: true }).promise;
    if (pdf.numPages !== 300) throw new Error(`Expected 300 pages, found ${pdf.numPages}`);
    await renderPage();
  } catch (error) {
    status.textContent = `PDF load failed: ${(error as Error).message}`;
  }
}
