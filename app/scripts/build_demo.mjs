// Builds the static public demo (public/demo/*) from the SAMPLE set only. No database, storage or model calls.
// usage: node scripts/build_demo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSheets } from '../server/sheets.js';
import { stubSuggest } from '../shared/placement.js';
import { exportMarkupsPdf } from '../server/exportPdf.js';
import { markupCsv } from '../server/csv.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(APP, 'public', 'demo'); fs.mkdirSync(OUT, { recursive: true });
const pdf = fs.readFileSync(path.join(APP, 'sample', 'sample-electrical-plan-E101-E201.pdf'));
const sheets = (await extractSheets(pdf)).map((s, i) => ({ ...s, id: `demo-sheet-${i + 1}`, drawingId: 'demo-set' }));
const people = { 'demo-fm': { name: 'Sample Foreman', initials: 'JR', email: 'foreman@example.com' }, 'demo-pe': { name: 'Sample PE', initials: 'KL', email: 'pe@example.com' } };
const S = (n) => sheets.find((s) => s.number === n);
const caps = [
  { sheet: 'E-101', note: 'Panel LP-1 relocated 3 ft north to clear duct, conduits re-stubbed above', at: '2026-11-02T14:20:00Z', status: 'confirmed', confirmedAt: '2026-11-03T15:05:00Z' },
  { sheet: 'E-101', note: 'Floor box FB-1 moved 2 ft east, re-cored per GC walk', at: '2026-11-02T18:45:00Z', status: 'confirmed', confirmedAt: '2026-11-03T15:07:00Z' },
  { sheet: 'E-201', note: 'Corridor 107 fixtures shifted 2 ft south to clear sprinkler main, RFI-014', at: '2026-11-05T13:10:00Z', status: 'confirmed', confirmedAt: '2026-11-06T16:30:00Z' },
  { sheet: 'E-201', note: 'Break room 106 fixture moved 3 ft east to clear supply diffuser', at: '2026-11-06T17:55:00Z', status: 'draft' },
];
const markups = caps.map((c, i) => {
  const sh = S(c.sheet); const s = stubSuggest({ sheet: sh, note: c.note, initials: 'JR' });
  const d = new Date(c.at); const text = s.text.replace(/\(JR [^)]*\)$/, `(JR ${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)})`);
  return { id: `demo-mk-${i + 1}`, captureId: `demo-cap-${i + 1}`, sheetId: sh.id, page: sh.page, sheetNumber: sh.number, sheetTitle: sh.title, drawingId: 'demo-set',
    status: c.status, cloud: s.cloud, callout: s.callout, text, note: c.note, confidence: +s.confidence.toFixed(2), method: s.method, reasoning: s.reasoning, anchorText: s.anchorText,
    createdBy: 'demo-fm', capturedBy: 'demo-fm', capturedAt: c.at, createdAt: c.at, confirmedBy: c.confirmedAt ? 'demo-pe' : null, confirmedAt: c.confirmedAt || null };
});
const confirmed = markups.filter((m) => m.status === 'confirmed');
const ex = await exportMarkupsPdf(pdf, confirmed, { title: 'Sample Tenant Fit-Out (SAMPLE) - as-built record', log: true, people, tz: 'America/New_York', scopeLabel: 'Full set: Sample electrical set E-101/E-201 (SAMPLE)' });
fs.writeFileSync(path.join(OUT, 'sample-as-built-export.pdf'), ex.bytes);
fs.writeFileSync(path.join(OUT, 'sample-markup-log.csv'), markupCsv(markups, { people, tz: 'America/New_York' }).replace(/,\/api\/captures\/[^,]+\/photo,/g, ',,'));
fs.copyFileSync(path.join(APP, 'sample', 'sample-electrical-plan-E101-E201.pdf'), path.join(OUT, 'sample-set.pdf'));
fs.copyFileSync(path.join(APP, 'sample', 'sample-field-photo-LP1.jpg'), path.join(OUT, 'sample-photo.jpg'));
fs.writeFileSync(path.join(OUT, 'demo.json'), JSON.stringify({
  project: { name: 'Sample Tenant Fit-Out (SAMPLE)' },
  drawings: [{ id: 'demo-set', name: 'Sample electrical set E-101/E-201 (SAMPLE)', pages: sheets.length }],
  sheets, markups, people,
}));
console.log(`demo: ${sheets.length} sheets, ${markups.length} markups (${confirmed.length} confirmed), export has ${ex.count} annotations pairs`);
markups.forEach((m) => console.log(' ', m.sheetNumber, m.status, m.anchorText, '|', m.text.slice(0, 60)));
