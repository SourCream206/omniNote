export function rgb(hex: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffffff';
  return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function darkPaper(hex: string): boolean { return luminance(hex) < 0.18; }

export function paperLines(hex: string): string { return darkPaper(hex) ? '#ffffff35' : '#16263a25'; }

export function readableInk(ink: string, paper: string, highlighter = false): string {
  if (highlighter) return ink;
  const a = luminance(ink);
  const b = luminance(paper);
  const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (contrast >= 3) return ink;
  return darkPaper(paper) ? '#ffffff' : '#182334';
}
