// Extract per-page text items (PDF user-space coords) + sheet number/title/scale using pdf.js in Node.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractSheets(pdfBytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true, isEvalSupported: false }).promise;
  const sheets = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const [x0, y0, x1, y1] = page.view;
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((it) => it.str && it.str.trim())
      .map((it, i) => ({
        id: i,
        text: it.str.trim(),
        x: +it.transform[4].toFixed(1),
        y: +it.transform[5].toFixed(1),
        w: +it.width.toFixed(1),
        h: +(it.height || Math.abs(it.transform[3])).toFixed(1),
      }));
    const numCands = items.filter((it) => /^[A-Z]{1,2}-?\d{2,3}(\.\d+)?$/.test(it.text)).sort((a, b) => b.h - a.h);
    const number = numCands[0]?.text || `Sheet ${p}`;
    const titleCands = items.filter((it) => /PLAN|DETAIL|SCHEDULE|ELEVATION|DIAGRAM|RISER/i.test(it.text) && it.text.length < 60).sort((a, b) => b.h - a.h);
    const title = titleCands[0]?.text || '';
    let ptsPerFoot = null;
    const scaleItem = items.find((it) => /(\d+)\/(\d+)"\s*=\s*1'-0"/.test(it.text));
    if (scaleItem) {
      const m = scaleItem.text.match(/(\d+)\/(\d+)"\s*=\s*1'-0"/);
      ptsPerFoot = (72 * +m[1]) / +m[2];
    }
    sheets.push({ page: p, number, title, width: x1 - x0, height: y1 - y0, ptsPerFoot, items });
    page.cleanup();
  }
  await doc.destroy();
  return sheets;
}
