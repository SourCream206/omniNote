export function visiblePdfPages(slots: ArrayLike<{ getBoundingClientRect(): { top: number; bottom: number } }>, top: number, bottom: number): Set<number> {
  let start = 0;
  let end = slots.length;
  while (start < end) {
    const middle = (start + end) >> 1;
    if (slots[middle].getBoundingClientRect().bottom < top) start = middle + 1;
    else end = middle;
  }
  const visible = new Set<number>();
  for (let index = start; index < slots.length; index++) {
    if (slots[index].getBoundingClientRect().top > bottom) break;
    visible.add(index + 1);
  }
  return visible;
}

export function pdfPrintoutHeight(width: number, pageRatios: number[]): number {
  const pageWidth = Math.max(200, width - 24);
  return 16 + pageRatios.reduce((height, ratio) => height + Math.ceil(pageWidth * ratio) + 8, 0);
}
