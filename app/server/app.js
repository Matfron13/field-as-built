import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractSheets } from './sheets.js';
import { suggest } from './suggest.js';
import { exportMarkupsPdf } from './exportPdf.js';
import { jsonStore } from './store-json.js';
import { supabaseStore } from './store-supabase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'sample');

export function placementMode() { return process.env.XAI_API_KEY && process.env.FAB_PLACEMENT !== 'stub' ? 'llm' : 'stub'; }

// Stripe webhook signature check (v1 scheme) without the SDK.
function verifyStripe(raw, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2 && p[0] !== 'v1'));
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  const t = +parts.t; if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export function createApp() {
  const store = process.env.SUPABASE_URL ? supabaseStore(process.env) : jsonStore(process.env.FAB_DATA || path.join(ROOT, 'data'));
  const INITIALS = process.env.FAB_INITIALS || 'MF';
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
  const app = express();
  const wrap = (fn) => (q, r, n) => Promise.resolve(fn(q, r, n)).catch((e) => { console.error(e); r.status(500).json({ error: e.message }); });

  app.post('/api/stripe/webhook', express.raw({ type: '*/*' }), (q, r) => {
    const raw = q.body?.toString('utf8') || '';
    if (!verifyStripe(raw, q.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET)) return r.status(400).json({ error: 'invalid signature' });
    const evt = JSON.parse(raw);
    console.log(`stripe event ${evt.type} ${evt.id}`); // MVP: acknowledge only; subscription handling comes with billing work
    r.json({ received: true });
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/config', (_q, r) => r.json({ placement: placementMode(), model: placementMode() === 'llm' ? (process.env.FAB_VISION_MODEL || 'grok-4.20-0309-non-reasoning') : null, initials: INITIALS, store: store.kind }));
  app.get('/api/state', wrap(async (_q, r) => r.json(await store.getState())));

  const loadDrawing = async (bytes, name) => { const sheets = await extractSheets(bytes); await store.replaceDrawing(name, bytes, sheets); return sheets.length; };
  app.post('/api/drawings', upload.single('pdf'), wrap(async (q, r) => {
    if (!q.file) return r.status(400).json({ error: 'pdf required' });
    try { await loadDrawing(q.file.buffer, q.file.originalname); } catch (e) { return r.status(400).json({ error: `Could not read PDF: ${e.message}` }); }
    r.json({ ok: true });
  }));
  app.post('/api/sample/drawing', wrap(async (_q, r) => {
    await loadDrawing(fs.readFileSync(path.join(SAMPLE, 'sample-electrical-plan-E101-E201.pdf')), 'sample-electrical-plan-E101-E201.pdf (SAMPLE)');
    r.json({ ok: true });
  }));
  app.get('/api/sample/photo', (_q, r) => r.type('image/jpeg').send(fs.readFileSync(path.join(SAMPLE, 'sample-field-photo-LP1.jpg'))));
  app.get('/api/drawings/:id/file', wrap(async (q, r) => { const b = await store.getDrawing(q.params.id); b ? r.type('application/pdf').send(b) : r.sendStatus(404); }));
  app.get('/api/captures/:id/photo', wrap(async (q, r) => { const p = await store.getPhoto(q.params.id); p ? r.type(p.mime).set('Cache-Control', 'private, max-age=3600').send(p.bytes) : r.sendStatus(404); }));

  app.post('/api/captures', upload.single('photo'), wrap(async (q, r) => {
    const sheet = await store.getSheet(q.body.sheetId);
    if (!sheet) return r.status(400).json({ error: 'pick a sheet first' });
    if (!q.file) return r.status(400).json({ error: 'photo required' });
    const note = (q.body.note || '').trim(); if (!note) return r.status(400).json({ error: 'note required' });
    const ext = (path.extname(q.file.originalname || '') || '.jpg').toLowerCase();
    const capture = await store.addCapture({ sheetId: sheet.id, note, noteSource: q.body.noteSource || 'text', photoBytes: q.file.buffer, photoMime: q.file.mimetype, ext });
    const t0 = Date.now();
    const s = await suggest({ sheet, note, photoBytes: q.file.buffer, photoMime: q.file.mimetype, initials: INITIALS, mode: q.body.mode });
    const markup = await store.addMarkup({ captureId: capture.id, sheetId: sheet.id, page: sheet.page, status: 'draft', cloud: s.cloud, callout: s.callout, text: s.text, author: `${INITIALS} (Field As-Built)`, confidence: +s.confidence.toFixed(2), method: s.method, reasoning: s.reasoning, anchorText: s.anchorText, usage: s.usage || null, suggestMs: Date.now() - t0, createdAt: new Date().toISOString() });
    r.json({ capture, markup });
  }));

  app.patch('/api/markups/:id', wrap(async (q, r) => {
    const { cloud, callout, text, status, by } = q.body; const fields = {}; const actions = [];
    if (cloud) { fields.cloud = cloud; actions.push('moved'); }
    if (callout) { fields.callout = callout; actions.push('callout-moved'); }
    if (typeof text === 'string') { fields.text = text; actions.push('edited'); }
    if (status && ['draft', 'confirmed', 'rejected'].includes(status)) {
      fields.status = status; actions.push(status);
      if (status === 'confirmed') { fields.confirmedAt = new Date().toISOString(); fields.confirmedBy = by || 'PE'; }
    }
    const m = await store.updateMarkup(q.params.id, fields, actions, by || 'user');
    m ? r.json(m) : r.sendStatus(404);
  }));

  app.get('/api/export', wrap(async (q, r) => {
    const pdf = await store.getDrawing(null); if (!pdf) return r.status(400).json({ error: 'no drawing' });
    const ms = await store.listMarkups((q.query.statuses || 'confirmed').split(','));
    const { bytes, count } = await exportMarkupsPdf(pdf, ms, { title: 'As-built record set (Field As-Built prototype)' });
    r.set('X-Markup-Count', String(count));
    r.set('Content-Disposition', `attachment; filename="as-built-${new Date().toISOString().slice(0, 10)}.pdf"`);
    r.type('application/pdf').send(Buffer.from(bytes));
  }));

  app.post('/api/reset', wrap(async (_q, r) => { await store.reset(); r.json({ ok: true }); }));
  return app;
}
