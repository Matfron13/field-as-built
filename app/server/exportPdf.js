// Write markups into the drawing PDF as real, editable annotations (Bluebeam-compatible):
//  - Cloud:   /Subtype /Polygon  /IT /PolygonCloud  /BE << /S /C /I 1 >>
//  - Callout: /Subtype /FreeText /IT /FreeTextCallout /CL [...] /LE /OpenArrow, grouped to the cloud via /IRT + /RT /Group
// Each gets an /AP appearance stream so any viewer (Chrome, Acrobat, pdf.js, Bluebeam) shows it without regenerating.
import { PDFDocument, PDFName, PDFHexString, PDFString, StandardFonts } from 'pdf-lib';

const f = (n) => (Math.round(n * 100) / 100).toString();
const pdfDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(); const s = off >= 0 ? '+' : '-';
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${s}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
};

// Scalloped cloud path around a rectangle (clockwise), bumps bulge outward.
function cloudPath({ x, y, w, h }, bump = 10) {
  const pts = [[x, y], [x, y + h], [x + w, y + h], [x + w, y]]; // clockwise in PDF space (y up): BL->TL->TR->BR
  let ops = `${f(x)} ${f(y)} m\n`;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay); const n = Math.max(2, Math.round(len / (bump * 2)));
    const ux = (bx - ax) / len, uy = (by - ay) / len; const nx = -uy, ny = ux; // left normal = outward for clockwise
    const seg = len / n, k = seg * 0.65;
    for (let j = 0; j < n; j++) {
      const sx = ax + ux * seg * j, sy = ay + uy * seg * j, ex = ax + ux * seg * (j + 1), ey = ay + uy * seg * (j + 1);
      ops += `${f(sx + nx * k)} ${f(sy + ny * k)} ${f(ex + nx * k)} ${f(ey + ny * k)} ${f(ex)} ${f(ey)} c\n`;
    }
  }
  return ops;
}

function wrap(font, text, size, maxW) {
  const lines = []; let cur = '';
  for (const word of text.split(/\s+/)) {
    const t = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(t, size) <= maxW || !cur) cur = t; else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}
const esc = (s) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');

export const dayKey = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const timeOf = (iso, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export function groupByCaptureDate(markups, tz) {
  const g = new Map();
  for (const m of markups) { const k = dayKey(m.capturedAt || m.createdAt, tz); if (!g.has(k)) g.set(k, []); g.get(k).push(m); }
  return [...g.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
const who = (people, id) => (id && people?.[id] ? (people[id].initials || people[id].name || people[id].email) : '');

// Appended "Markup log" page(s): every exported markup, grouped by capture date.
async function addLogPages(doc, markups, { tz, people, title, scopeLabel }) {
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792, H = 612, M = 40; let page = doc.addPage([W, H]); let y = H - M;
  const line = (txt, { size = 9, f = font, x = M, color } = {}) => { page.drawText(esc(txt).replace(/\\([\\()])/g, '$1'), { x, y, size, font: f, ...(color ? { color } : {}) }); };
  const need = (h) => { if (y - h < M) { page = doc.addPage([W, H]); y = H - M; } };
  line(`Markup log: ${title}`, { size: 14, f: bold }); y -= 16;
  line(`${scopeLabel} - ${markups.length} markup(s), grouped by capture date (${tz}). Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`, { size: 9 }); y -= 18;
  const cols = [[M, 'Time'], [M + 50, 'Sheet'], [M + 105, 'Status'], [M + 170, 'By / Confirmed'], [M + 270, 'Markup text']];
  for (const [day, ms] of groupByCaptureDate(markups, tz)) {
    need(40); line(`${day}  (${ms.length})`, { size: 11, f: bold }); y -= 14;
    cols.forEach(([x, t]) => line(t, { size: 8, f: bold, x })); y -= 11;
    for (const m of ms) {
      const lines = wrap(font, esc(m.text).replace(/\\([\\()])/g, '$1'), 8.5, W - M - (M + 270));
      need(lines.length * 10.5 + 4);
      line(timeOf(m.capturedAt || m.createdAt, tz), { size: 8.5 });
      line(m.sheetNumber || `p${m.page}`, { size: 8.5, x: M + 50 });
      line(m.status.toUpperCase(), { size: 8.5, x: M + 105, f: bold });
      line(`${who(people, m.capturedBy)}${m.confirmedBy ? ' / ' + who(people, m.confirmedBy) : ''}`, { size: 8.5, x: M + 170 });
      lines.forEach((ln, i) => { page.drawText(ln, { x: M + 270, y: y - i * 10.5, size: 8.5, font }); });
      y -= lines.length * 10.5 + 4;
    }
    y -= 8;
  }
}

// opts.pages: 1-based page numbers to keep (null = full set). opts.log: append markup log pages.
export async function exportMarkupsPdf(pdfBytes, markups, opts = {}) {
  const doc = await PDFDocument.load(pdfBytes);
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontRef = font.ref;
  const pages = doc.getPages();
  const red = [1, 0, 0];
  let count = 0;
  for (const m of markups) {
    const page = pages[m.page - 1]; if (!page) continue;
    if (opts.pages && !opts.pages.includes(m.page)) continue;
    const c = m.cloud, co = m.callout; const bump = Math.max(5, Math.min(12, Math.min(c.w, c.h) / 6));
    const now = pdfDate(new Date(m.confirmedAt || m.createdAt || Date.now()));
    const author = m.author || (who(opts.people, m.capturedBy) ? `${who(opts.people, m.capturedBy)} (Field Redline)` : 'Field Redline');
    const capDay = dayKey(m.capturedAt || m.createdAt, opts.tz || 'America/New_York');
    const status = m.status === 'confirmed' ? 'Confirmed' : m.status === 'rejected' ? 'Rejected' : 'Draft';
    // --- Cloud polygon
    const pad = bump * 0.9 + 2;
    const cRect = [c.x - pad, c.y - pad, c.x + c.w + pad, c.y + c.h + pad];
    const cAp = ctx.stream(`q 1 0 0 RG 1.5 w 1 J 1 j\n${cloudPath(c, bump)}S Q`, {
      Type: 'XObject', Subtype: 'Form', BBox: cRect, Resources: {},
    });
    const cloudDict = ctx.obj({
      Type: 'Annot', Subtype: 'Polygon', Rect: cRect, F: 4,
      Vertices: [c.x, c.y, c.x, c.y + c.h, c.x + c.w, c.y + c.h, c.x + c.w, c.y],
      C: red, CA: 1, BS: { Type: 'Border', W: 1.5, S: 'S' }, BE: { S: 'C', I: 1 },
      IT: 'PolygonCloud', Subj: PDFString.of(`Cloud - captured ${capDay}`), T: PDFHexString.fromText(author),
      Contents: PDFHexString.fromText(m.text), NM: PDFString.of(`fab-cloud-${m.id}`),
      M: PDFString.of(now), CreationDate: PDFString.of(now),
      AP: { N: ctx.register(cAp) },
    });
    // custom keys (ignored by viewers; useful for round-trip)
    cloudDict.set(PDFName.of('FAB_Status'), PDFString.of(status));
    if (m.captureId) cloudDict.set(PDFName.of('FAB_Capture'), PDFString.of(String(m.captureId)));
    const cloudRef = ctx.register(cloudDict);
    page.node.addAnnot(cloudRef);
    // --- FreeText callout with leader line from the cloud edge to the text box
    const size = 8, lh = 9.5, inner = 4;
    const lines = wrap(font, esc(m.text), size, co.w - inner * 2);
    const boxH = Math.max(co.h, lines.length * lh + inner * 2);
    const box = { x: co.x, y: co.y + co.h - boxH, w: co.w, h: boxH };
    const cxm = c.x + c.w / 2, cym = c.y + c.h / 2, bxm = box.x + box.w / 2, bym = box.y + box.h / 2;
    // start point: cloud edge toward the box; end: nearest vertical side of box
    const dx = bxm - cxm, dy = bym - cym; const sc = Math.min(Math.abs((c.w / 2 + bump * 0.6) / (dx || 1e-6)), Math.abs((c.h / 2 + bump * 0.6) / (dy || 1e-6)));
    const p1 = [cxm + dx * Math.min(sc, 1), cym + dy * Math.min(sc, 1)];
    const p3 = [dx >= 0 ? box.x : box.x + box.w, bym];
    const p2 = [p3[0] + (dx >= 0 ? -15 : 15), p3[1]];
    const minX = Math.min(box.x, p1[0], p2[0]) - 6, minY = Math.min(box.y, p1[1], p2[1]) - 6;
    const maxX = Math.max(box.x + box.w, p1[0], p2[0]) + 6, maxY = Math.max(box.y + box.h, p1[1], p2[1]) + 6;
    const tRect = [minX, minY, maxX, maxY];
    const RD = [box.x - minX, box.y - minY, maxX - (box.x + box.w), maxY - (box.y + box.h)];
    // arrowhead at p1 (open arrow)
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), al = 7, aw = 0.45;
    const a1 = [p1[0] + al * Math.cos(ang + aw), p1[1] + al * Math.sin(ang + aw)], a2 = [p1[0] + al * Math.cos(ang - aw), p1[1] + al * Math.sin(ang - aw)];
    let txt = `BT /Helv ${size} Tf 1 0 0 rg\n`;
    lines.forEach((ln, i) => { txt += `1 0 0 1 ${f(box.x + inner)} ${f(box.y + box.h - inner - size - i * lh + 1)} Tm (${ln}) Tj\n`; });
    txt += 'ET';
    const tAp = ctx.stream(
      `q 1 1 1 rg ${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)} re f Q\n` +
      `q 1 0 0 RG 1 w ${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)} re S\n` +
      `${f(p1[0])} ${f(p1[1])} m ${f(p2[0])} ${f(p2[1])} l ${f(p3[0])} ${f(p3[1])} l S\n` +
      `${f(a1[0])} ${f(a1[1])} m ${f(p1[0])} ${f(p1[1])} l ${f(a2[0])} ${f(a2[1])} l S Q\n` + txt,
      { Type: 'XObject', Subtype: 'Form', BBox: tRect, Resources: { Font: { Helv: fontRef } } },
    );
    const textDict = ctx.obj({
      Type: 'Annot', Subtype: 'FreeText', IT: 'FreeTextCallout', Rect: tRect, RD, F: 4,
      CL: [p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]], LE: 'OpenArrow',
      DA: PDFString.of(`/Helv ${size} Tf 1 0 0 rg`), DS: PDFString.of(`font: Helvetica ${size}pt; text-align:left; color:#FF0000`),
      C: red, BS: { Type: 'Border', W: 1, S: 'S' },
      Subj: PDFString.of(`Callout - captured ${capDay}`), T: PDFHexString.fromText(author), Contents: PDFHexString.fromText(m.text),
      NM: PDFString.of(`fab-callout-${m.id}`), M: PDFString.of(now), CreationDate: PDFString.of(now),
      IRT: cloudRef, RT: 'Group',
      AP: { N: ctx.register(tAp) },
    });
    page.node.addAnnot(ctx.register(textDict));
    count++;
  }
  if (opts.pages) {
    const keep = new Set(opts.pages);
    for (let i = pages.length; i >= 1; i--) if (!keep.has(i)) doc.removePage(i - 1);
  }
  if (opts.log) await addLogPages(doc, markups, { tz: opts.tz || 'America/New_York', people: opts.people, title: opts.title || 'As-built record set', scopeLabel: opts.scopeLabel || 'Full set' });
  if (opts.title) doc.setSubject(opts.title);
  doc.setModificationDate(new Date());
  doc.setProducer('Field Redline prototype (pdf-lib)');
  return { bytes: await doc.save(), count };
}
