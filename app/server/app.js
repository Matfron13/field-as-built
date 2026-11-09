import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractSheets } from './sheets.js';
import { suggest } from './suggest.js';
import { exportMarkupsPdf } from './exportPdf.js';
import { supabaseStore, userClient, anonClient } from './store-supabase.js';
import { markupCsv } from './csv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'sample');

export const SPEND_CAP_USD = +(process.env.FAB_AI_MONTHLY_CAP_USD || 9.5);
const GATEWAY_MODEL = process.env.FAB_VISION_MODEL || 'spacexai/grok-4.20-non-reasoning';
// FAB_PLACEMENT=ai -> Vercel AI Gateway (OIDC token on Vercel, or AI_GATEWAY_API_KEY). FAB_PLACEMENT=xai-direct -> local dev only. Anything else -> stub.
export function placementMode() { return ['ai', 'xai-direct'].includes(process.env.FAB_PLACEMENT) ? 'llm' : 'stub'; }
function providerFor(req) {
  if (process.env.FAB_PLACEMENT === 'ai') {
    const key = req.get('x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY;
    return key ? { url: 'https://ai-gateway.vercel.sh/v1/chat/completions', key, model: GATEWAY_MODEL, route: 'vercel-ai-gateway' } : null;
  }
  if (process.env.FAB_PLACEMENT === 'xai-direct' && process.env.XAI_API_KEY) return { url: 'https://api.x.ai/v1/chat/completions', key: process.env.XAI_API_KEY, model: process.env.FAB_VISION_MODEL || 'grok-4.20-0309-non-reasoning', route: 'xai-direct' };
  return null;
}

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
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required');
  const anon = anonClient(env);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', true);
  // Public marketing pages (/ and /demo) may be indexed; the signed-in app and the API never are.
  app.use((q, r, n) => { if (/^\/(api|app)(\/|$)/.test(q.path)) r.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); n(); });
  const wrap = (fn) => (q, r, n) => Promise.resolve(fn(q, r, n)).catch((e) => { console.error(e); r.status(e.status || 500).json({ error: e.message }); });
  const deny = (msg = 'not allowed for your role') => Object.assign(new Error(msg), { status: 403 });

  app.post('/api/stripe/webhook', express.raw({ type: '*/*' }), (q, r) => {
    const raw = q.body?.toString('utf8') || '';
    if (!verifyStripe(raw, q.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) return r.status(400).json({ error: 'invalid signature' });
    const evt = JSON.parse(raw);
    console.log(`stripe event ${evt.type} ${evt.id}`); // MVP: acknowledge only; subscription handling comes with billing work
    r.json({ received: true });
  });
  app.use(express.json({ limit: '2mb' }));

  // Public: only what the login screen needs (the publishable key is designed to be public; RLS protects data).
  app.get('/api/public-config', (_q, r) => r.json({ supabaseUrl: env.SUPABASE_URL, supabaseKey: env.SUPABASE_PUBLISHABLE_KEY, signup: false }));

  // Public: "Request a pilot" form. Inserted as the anonymous role (RLS: insert only, nobody can read via the API).
  // Rate limits: per client IP here (best effort per instance) + per email / site-wide in a DB trigger.
  const leadHits = new Map();
  app.post('/api/leads', wrap(async (q, r) => {
    const ip = (q.get('x-forwarded-for') || q.ip || '').split(',')[0].trim();
    const now = Date.now(); const hits = (leadHits.get(ip) || []).filter((t) => now - t < 3600e3);
    if (hits.length >= 20) return r.status(429).json({ error: 'Too many requests. Please try again later or email us.' });
    const b = q.body || {}; const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    if (str(b.website, 200)) return r.json({ ok: true }); // honeypot: silently drop bots
    const lead = { name: str(b.name, 120), email: str(b.email, 200), company: str(b.company, 160) || null, role: str(b.role, 60) || null, message: str(b.message, 2000) || null, source: str(b.source, 40) || 'landing' };
    if (!lead.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) return r.status(400).json({ error: 'Please enter your name and a valid email.' });
    const { error } = await anon.from('leads').insert(lead);
    if (error) return /rate limited/.test(error.message) ? r.status(429).json({ error: 'Too many requests for this email. Please try again later.' }) : r.status(400).json({ error: 'Could not save your request. Please check the fields.' });
    hits.push(now); leadHits.set(ip, hits); if (leadHits.size > 5000) leadHits.clear(); // count accepted leads per IP
    r.status(201).json({ ok: true });
  }));

  // ---- auth gate: every other /api route needs a valid Supabase session (Authorization: Bearer <access token>)
  const seen = new Map(); // token -> {user, exp}
  app.use('/api', wrap(async (q, r, n) => {
    const m = /^Bearer (.+)$/.exec(q.get('authorization') || '');
    if (!m) return r.status(401).json({ error: 'sign in required' });
    const token = m[1]; let hit = seen.get(token);
    if (!hit || hit.exp < Date.now()) {
      const { data, error } = await anon.auth.getUser(token);
      if (error || !data?.user) return r.status(401).json({ error: 'session expired, sign in again' });
      hit = { user: data.user, exp: Date.now() + 60_000 }; seen.set(token, hit);
      if (seen.size > 500) seen.clear();
    }
    q.user = hit.user; q.store = supabaseStore(userClient(env, token), hit.user.id);
    n();
  }));
  // project + role resolution for project-scoped routes
  async function ctx(q, pid) {
    const project = await q.store.getProject(pid); if (!project) throw Object.assign(new Error('project not found'), { status: 404 });
    const me = await q.store.me(); const mem = me.memberships.find((x) => x.orgId === project.orgId);
    if (!mem) throw deny('not a member of this project');
    return { project, role: mem.role, canReview: mem.role === 'admin' || mem.role === 'pe' };
  }

  const spend = async (store) => { try { return await store.monthSpend(); } catch (e) { console.error('spend lookup failed', e); return null; } };
  app.get('/api/config', wrap(async (q, r) => {
    const mode = placementMode(); const mtd = mode === 'llm' ? await spend(q.store) : null;
    const capped = mode === 'llm' && (mtd == null || mtd >= SPEND_CAP_USD);
    r.json({ placement: capped ? 'stub' : mode, configured: mode, model: mode === 'llm' ? (providerFor(q)?.model || GATEWAY_MODEL) : null, capped, monthSpendUsd: mtd, capUsd: SPEND_CAP_USD });
  }));
  app.get('/api/me', wrap(async (q, r) => {
    const [me, projects] = await Promise.all([q.store.me(), q.store.listProjects()]);
    r.json({ user: { id: q.user.id, email: q.user.email }, ...me, projects });
  }));
  app.post('/api/projects', wrap(async (q, r) => {
    const me = await q.store.me(); const orgId = q.body.orgId || me.memberships[0]?.orgId;
    const mem = me.memberships.find((x) => x.orgId === orgId); if (!mem || mem.role === 'foreman') throw deny('only a PE or admin can create projects');
    const name = (q.body.name || '').trim(); if (!name) return r.status(400).json({ error: 'name required' });
    r.json(await q.store.createProject(orgId, name, (q.body.number || '').trim()));
  }));
  app.get('/api/projects/:pid/state', wrap(async (q, r) => {
    const { project, role, canReview } = await ctx(q, q.params.pid);
    r.json({ project, role, canReview, ...(await q.store.projectState(project.id)) });
  }));

  const addSet = async (q, bytes, name) => {
    const { project, canReview } = await ctx(q, q.params.pid); if (!canReview) throw deny('only a PE or admin can add drawing sets');
    const sheets = await extractSheets(bytes); return q.store.addDrawingSet(project, name, bytes, sheets);
  };
  app.post('/api/projects/:pid/drawings', upload.single('pdf'), wrap(async (q, r) => {
    if (!q.file) return r.status(400).json({ error: 'pdf required' });
    let id; try { id = await addSet(q, q.file.buffer, (q.body.name || q.file.originalname || 'Drawing set').slice(0, 200)); } catch (e) { if (e.status) throw e; return r.status(400).json({ error: `Could not read PDF: ${e.message}` }); }
    r.json({ ok: true, id });
  }));
  app.post('/api/projects/:pid/sample', wrap(async (q, r) => {
    r.json({ ok: true, id: await addSet(q, fs.readFileSync(path.join(SAMPLE, 'sample-electrical-plan-E101-E201.pdf')), 'Sample electrical set E-101/E-201 (SAMPLE)') });
  }));
  app.get('/api/sample/photo', (_q, r) => r.type('image/jpeg').send(fs.readFileSync(path.join(SAMPLE, 'sample-field-photo-LP1.jpg'))));
  app.get('/api/drawings/:id/file', wrap(async (q, r) => { const b = await q.store.getDrawingBytes(q.params.id); b ? r.type('application/pdf').set('Cache-Control', 'private, max-age=86400').send(b) : r.sendStatus(404); }));
  app.get('/api/captures/:id/photo', wrap(async (q, r) => { const p = await q.store.getPhoto(q.params.id); p ? r.type(p.mime).set('Cache-Control', 'private, max-age=3600').send(p.bytes) : r.sendStatus(404); }));

  app.post('/api/captures', upload.single('photo'), wrap(async (q, r) => {
    const sheet = await q.store.getSheet(q.body.sheetId);
    if (!sheet) return r.status(400).json({ error: 'pick a sheet first' });
    const { project } = await ctx(q, sheet.projectId);
    const clientId = /^[0-9a-f-]{36}$/i.test(q.body.clientId || '') ? q.body.clientId : null;
    if (clientId) { const dup = await q.store.findCaptureByClientId(clientId); if (dup?.markup) return r.json({ ...dup, duplicate: true }); }
    if (!q.file) return r.status(400).json({ error: 'photo required' });
    const note = (q.body.note || '').trim(); if (!note) return r.status(400).json({ error: 'note required' });
    let capturedAt = null; const ca = Date.parse(q.body.capturedAt || ''); if (ca && ca <= Date.now() + 5 * 60e3 && ca > Date.now() - 90 * 864e5) capturedAt = new Date(ca).toISOString();
    const ext = (path.extname(q.file.originalname || '') || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6) || '.jpg';
    const capture = await q.store.addCapture({ project, sheetId: sheet.id, note, noteSource: q.body.noteSource || 'text', photoBytes: q.file.buffer, photoMime: q.file.mimetype, ext, clientId, capturedAt });
    // Spend guard: only call the model while month-to-date spend is under the cap; fail closed if spend can't be read.
    let mode = q.body.mode === 'stub' ? 'stub' : placementMode(); let stubReason = null, stubNote = null;
    const provider = mode === 'llm' ? providerFor(q) : null;
    if (mode === 'llm' && !provider) { mode = 'stub'; stubReason = 'no-ai-credentials'; stubNote = 'AI placement unavailable (no Gateway credentials);'; }
    if (mode === 'llm') {
      const mtd = await spend(q.store);
      if (mtd == null) { mode = 'stub'; stubReason = 'spend-check-failed'; stubNote = 'Could not read AI spend, so AI is paused for safety;'; }
      else if (mtd >= SPEND_CAP_USD) { mode = 'stub'; stubReason = 'monthly-cap'; stubNote = `AI paused: month-to-date AI spend $${mtd.toFixed(2)} reached the $${SPEND_CAP_USD.toFixed(2)} cap;`; }
    }
    const t0 = Date.now(); const initials = (q.user.user_metadata?.initials || 'FR').slice(0, 4);
    const s = await suggest({ sheet, note, photoBytes: q.file.buffer, photoMime: q.file.mimetype, initials, mode, provider, stubReason, stubNote });
    if (mode === 'llm') {
      const u = s.usage;
      try {
        await q.store.logAiUsage({ orgId: project.orgId, projectId: project.id, captureId: capture.id, model: provider.model, route: provider.route, tokensIn: u?.input || 0, tokensInCached: u?.cached || 0, tokensOut: u?.output || 0, estCost: u?.estCost || 0, gatewayCost: u?.gatewayCost ?? null, ok: !s.llmError, error: s.llmError || null, latencyMs: Date.now() - t0 });
      } catch (e) { console.error('ai usage log failed', e); }
    }
    const markup = await q.store.addMarkup({ projectId: project.id, captureId: capture.id, sheetId: sheet.id, cloud: s.cloud, callout: s.callout, text: s.text, confidence: +s.confidence.toFixed(2), method: s.method, reasoning: s.reasoning, anchorText: s.anchorText, usage: s.usage || null });
    r.json({ capture, markup });
  }));

  app.patch('/api/markups/:id', wrap(async (q, r) => {
    const cur = await q.store.getMarkup(q.params.id); if (!cur) return r.sendStatus(404);
    const { canReview } = await ctx(q, cur.projectId);
    const { cloud, callout, text, status } = q.body; const fields = {}; const actions = [];
    if (!canReview && (status || cur.status !== 'draft' || cur.createdBy !== q.user.id)) throw deny('foremen can adjust their own drafts; a PE confirms or rejects');
    if (cloud) { fields.cloud = cloud; actions.push('moved'); }
    if (callout) { fields.callout = callout; actions.push('callout-moved'); }
    if (typeof text === 'string') { fields.text = text; actions.push('edited'); }
    if (status && ['draft', 'confirmed', 'rejected'].includes(status)) { fields.status = status; actions.push(status); }
    r.json(await q.store.updateMarkup(q.params.id, fields, actions));
  }));

  // Export: ?drawingId=<set> [&sheetId=<one sheet>] [&statuses=confirmed,draft] [&tz=America/New_York]
  const exportScope = async (q) => {
    const { project, canReview } = await ctx(q, q.params.pid); if (!canReview) throw deny('only a PE or admin can export the record set');
    const statuses = (q.query.statuses || 'confirmed').split(',').filter((x) => ['confirmed', 'draft', 'rejected'].includes(x));
    const tz = /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(q.query.tz || '') ? q.query.tz : 'America/New_York';
    let sheet = null, drawingId = q.query.drawingId || null;
    if (q.query.sheetId) { sheet = await q.store.getSheet(q.query.sheetId); if (!sheet || sheet.projectId !== project.id) throw Object.assign(new Error('sheet not found'), { status: 404 }); drawingId = sheet.drawingId; }
    const ms = await q.store.listMarkups(project.id, statuses, { drawingId, sheetId: sheet?.id });
    return { project, statuses, tz, sheet, drawingId, ms, people: await q.store.people() };
  };
  const stamp = () => new Date().toISOString().slice(0, 10);
  const slug = (s) => (s || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
  app.get('/api/projects/:pid/export.pdf', wrap(async (q, r) => {
    const x = await exportScope(q); if (!x.drawingId) return r.status(400).json({ error: 'pick a drawing set' });
    const set = await q.store.getDrawingSet(x.drawingId); if (!set || set.projectId !== x.project.id) return r.status(404).json({ error: 'drawing set not found' });
    const pdf = await q.store.getDrawingBytes(set.id);
    const scopeLabel = x.sheet ? `Sheet ${x.sheet.number || x.sheet.page}` : `Full set: ${set.name}`;
    const { bytes, count } = await exportMarkupsPdf(pdf, x.ms, { title: `${x.project.name} - as-built record`, pages: x.sheet ? [x.sheet.page] : null, log: true, people: x.people, tz: x.tz, scopeLabel });
    try { await q.store.logExport(x.project.id, x.sheet ? [x.sheet.id] : null, x.statuses.includes('draft'), count); } catch (e) { console.error('export log failed', e); }
    r.set('X-Markup-Count', String(count));
    r.set('Content-Disposition', `attachment; filename="as-built-${slug(x.project.name)}-${x.sheet ? slug(x.sheet.number) : 'full-set'}-${stamp()}.pdf"`);
    r.type('application/pdf').send(Buffer.from(bytes));
  }));
  app.get('/api/projects/:pid/markups.csv', wrap(async (q, r) => {
    const x = await exportScope(q);
    r.set('X-Markup-Count', String(x.ms.length));
    r.set('Content-Disposition', `attachment; filename="markup-log-${slug(x.project.name)}-${x.sheet ? slug(x.sheet.number) : 'all'}-${stamp()}.csv"`);
    r.type('text/csv; charset=utf-8').send(markupCsv(x.ms, { people: x.people, tz: x.tz, base: `${q.protocol}://${q.get('host')}` }));
  }));

  app.post('/api/projects/:pid/reset', wrap(async (q, r) => {
    const { project, role } = await ctx(q, q.params.pid); if (role !== 'admin' && role !== 'pe') throw deny();
    await q.store.resetProject(project); r.json({ ok: true });
  }));
  app.use('/api', (_q, r) => r.status(404).json({ error: 'not found' }));
  return app;
}
