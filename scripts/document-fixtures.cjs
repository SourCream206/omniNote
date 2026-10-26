const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

const output = path.resolve(__dirname, '..', 'workspace', 'fixtures');
fs.mkdirSync(output, { recursive: true });

function pdf() {
  const stream = (source) => `<< /Length ${Buffer.byteLength(source)} >>\nstream\n${source}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R /Annots [8 0 R 9 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    stream('BT /F1 18 Tf 72 720 Td (External example.com) Tj 0 -36 Td (Jump to page 2) Tj ET'),
    stream('BT /F1 18 Tf 72 720 Td (Page two) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Annot /Subtype /Link /Rect [72 715 260 740] /Border [0 0 0] /A << /S /URI /URI (https://example.com) >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [72 675 260 705] /Border [0 0 0] /Dest [4 0 R /Fit] >>',
  ];
  let source = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

async function docx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="rId2"><w:r><w:t>External example.com</w:t></w:r></w:hyperlink></w:p><w:p><w:hyperlink w:anchor="target"><w:r><w:t>Jump to bookmark</w:t></w:r></w:hyperlink></w:p><w:p><w:bookmarkStart w:id="1" w:name="target"/><w:r><w:t>Bookmark target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p><w:sectPr/></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function main() {
  const pdfBytes = pdf();
  const docxBytes = await docx();
  fs.writeFileSync(path.join(output, 'link-test.pdf'), pdfBytes);
  fs.writeFileSync(path.join(output, 'link-test.docx'), docxBytes);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true }).promise;
  const annotations = await (await document.getPage(1)).getAnnotations();
  assert.ok(annotations.some((annotation) => annotation.url === 'https://example.com/'));
  assert.ok(annotations.some((annotation) => annotation.dest));
  const loadedDocx = await JSZip.loadAsync(docxBytes);
  assert.match(await loadedDocx.file('word/_rels/document.xml.rels').async('string'), /Target="https:\/\/example.com"/);
  assert.match(await loadedDocx.file('word/document.xml').async('string'), /w:anchor="target"/);
  console.log(`PDF and DOCX link fixtures passed: ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
