const fs = require('node:fs');
const path = require('node:path');

const pageCount = 300;
const firstPage = 3;
const fontId = firstPage + pageCount;
const firstContent = fontId + 1;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${firstPage + index} 0 R`).join(' ')}] /Count ${pageCount} >>`,
];

for (let index = 0; index < pageCount; index++) {
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${firstContent + index} 0 R >>`);
}
objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
for (let index = 0; index < pageCount; index++) {
  const content = `BT /F1 24 Tf 72 720 Td (Ink lab textbook fixture - page ${index + 1}) Tj 0 -40 Td /F1 13 Tf (Only the visible page should be rendered.) Tj ET`;
  objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
}

let pdf = '%PDF-1.7\n';
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const output = path.resolve(__dirname, '../public/fixtures/300-pages.pdf');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, pdf);
console.log(`Generated ${pageCount}-page PDF fixture (${Buffer.byteLength(pdf)} bytes)`);
