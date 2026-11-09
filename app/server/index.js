import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractSheets } from './sheets.js';
import { suggest } from './suggest.js';
import { exportMarkupsPdf } from './exportPdf.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.FAB_DATA || path.join(ROOT, 'data');
const FILES = path.join(DATA, 'files');
fs.mkdirSync(FILES, { recursive: true });
const DBF = path.join(DATA, 'db.json');
const SAMPLE = path.resolve(ROOT, '..', 'sample');
const PORT = +process.env.PORT || 4317;
const INITIALS = process.env.FAB_INITIALS || 'MF';

const empty = () => ({ projects: [{ id: 'p1', name: 'Sample Tenant Fit-Out (demo)', createdAt: new Date().toISOString() }], drawings: [], sheets: [], captures: [], markups: [] });
let db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : empty();
const save = () => fs.writeFileSync(DBF, JSON.stringify(db, null, 1));
const id = () => crypto.randomUUID().slice(0, 8);
const publicSheet = ({ items, ...s }) => ({ ...s, textItemCount: items.length });

const upload = multer({ dest: path.join(DATA, 'tmp'), limits: { fileSize: 60 * 1024 * 1024 } });
const app = express();
app.use(express.json({ limit: '2mb' }));

const placementMode = () => (process.env.XAI_API_KEY && process.env.FAB_PLACEMENT !== 'stub' ? 'llm' : 'stub');
app.get('/api/config', (_q, r) => r.json({ placement: placementMode(), model: placementMode() === 'llm' ? (process.env.FAB_VISION_MODEL || 'grok-4.20-0309-non-reasoning') : null, initials: INITIALS }));

app.get('/api/state', (_q, r) => r.json({ project: db.projects[0], drawings: db.drawings, sheets: db.sheets.map(publicSheet), captures: db.captures, markups: db.markups }));

async function addDrawing(srcPath, name) {
  const did = id(); const dest = path.join(FILES, `${did}.pdf`);
  fs.copyFileSync(srcPath, dest);
  const sheets = await extractSheets(fs.readFileSync(dest));
  // MVP: one active drawing set per project (replacing it clears markups)
  db.drawings = [{ id: did, projectId: 'p1', name, file: dest, pages: sheets.length, uploadedAt: new Date().toISOString() }];
  db.sheets = sheets.map((s) => ({ id: `${did}-${s.page}`, drawingId: did, ...s }));
  db.captures = []; db.markups = [];
  save();
}

app.post('/api/drawings', upload.single('pdf'), async (q, r) => {
  try { await addDrawing(q.file.path, q.file.originalname); fs.rmSync(q.file.path, { force: true }); r.json({ ok: true, sheets: db.sheets.map(publicSheet) }); }
  catch (e) { r.status(400).json({ error: `Could not read PDF: ${e.message}` }); }
});
app.post('/api/sample/drawing', async (_q, r) => {
  await addDrawing(path.join(SAMPLE, 'sample-electrical-plan-E101-E201.pdf'), 'sample-electrical-plan-E101-E201.pdf (SAMPLE)');
  r.json({ ok: true, sheets: db.sheets.map(publicSheet) });
});
app.get('/api/sample/photo', (_q, r) => r.sendFile(path.join(SAMPLE, 'sample-field-photo-LP1.jpg')));
app.get('/api/drawings/:id/file', (q, r) => { const d = db.drawings.find((x) => x.id === q.params.id); d ? r.type('application/pdf').sendFile(d.file) : r.sendStatus(404); });
app.get('/api/captures/:id/photo', (q, r) => { const c = db.captures.find((x) => x.id === q.params.id); c ? r.type(c.photoMime).sendFile(c.photoFile) : r.sendStatus(404); });

app.post('/api/captures', upload.single('photo'), async (q, r) => {
  const sheet = db.sheets.find((s) => s.id === q.body.sheetId);
  if (!sheet) return r.status(400).json({ error: 'pick a sheet first' });
  if (!q.file) return r.status(400).json({ error: 'photo required' });
  const note = (q.body.note || '').trim();
  if (!note) return r.status(400).json({ error: 'note required' });
  const cid = id(); const ext = path.extname(q.file.originalname || '.jpg') || '.jpg';
  const photoFile = path.join(FILES, `${cid}${ext}`); fs.renameSync(q.file.path, photoFile);
  const capture = { id: cid, projectId: 'p1', sheetId: sheet.id, note, noteSource: q.body.noteSource || 'text', photoFile, photoMime: q.file.mimetype, capturedBy: q.body.by || 'Foreman', createdAt: new Date().toISOString(), gps: null };
  const t0 = Date.now();
  const s = await suggest({ sheet, note, photoPath: photoFile, photoMime: q.file.mimetype, initials: INITIALS, mode: q.body.mode });
  const markup = { id: id(), captureId: cid, sheetId: sheet.id, page: sheet.page, status: 'draft', cloud: s.cloud, callout: s.callout, text: s.text, author: `${INITIALS} (Field As-Built)`, confidence: +s.confidence.toFixed(2), method: s.method, reasoning: s.reasoning, anchorText: s.anchorText, usage: s.usage || null, suggestMs: Date.now() - t0, createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), action: 'suggested', by: s.method }] };
  db.captures.push(capture); db.markups.push(markup); save();
  r.json({ capture, markup });
});

app.patch('/api/markups/:id', (q, r) => {
  const m = db.markups.find((x) => x.id === q.params.id); if (!m) return r.sendStatus(404);
  const { cloud, callout, text, status, by } = q.body;
  const changed = [];
  if (cloud) { m.cloud = cloud; changed.push('moved'); }
  if (callout) { m.callout = callout; changed.push('callout-moved'); }
  if (typeof text === 'string') { m.text = text; changed.push('edited'); }
  if (status && ['draft', 'confirmed', 'rejected'].includes(status)) {
    m.status = status; changed.push(status);
    if (status === 'confirmed') { m.confirmedAt = new Date().toISOString(); m.confirmedBy = by || 'PE'; }
  }
  m.history.push({ at: new Date().toISOString(), action: changed.join(',') || 'noop', by: by || 'user' });
  save(); r.json(m);
});

app.get('/api/export', async (q, r) => {
  const d = db.drawings[0]; if (!d) return r.status(400).json({ error: 'no drawing' });
  const statuses = (q.query.statuses || 'confirmed').split(',');
  const ms = db.markups.filter((m) => statuses.includes(m.status));
  const { bytes, count } = await exportMarkupsPdf(fs.readFileSync(d.file), ms, { title: 'As-built record set (Field As-Built prototype)' });
  r.set('X-Markup-Count', String(count));
  r.set('Content-Disposition', `attachment; filename="as-built-${new Date().toISOString().slice(0, 10)}.pdf"`);
  r.type('application/pdf').send(Buffer.from(bytes));
});

app.post('/api/reset', (_q, r) => { db = empty(); save(); r.json({ ok: true }); });

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get(/^\/(?!api).*/, (_q, r) => r.sendFile(path.join(dist, 'index.html'))); }

app.listen(PORT, '0.0.0.0', () => console.log(`Field As-Built prototype on http://localhost:${PORT} (placement: ${placementMode()})`));
