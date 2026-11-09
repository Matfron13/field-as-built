// Supabase store, one instance per request, acting AS the signed-in user (their JWT), so Postgres RLS
// enforces org membership and roles on every read and write. No service-role key is used anywhere.
import { createClient } from '@supabase/supabase-js';

const ACTION = { moved: 'moved', 'callout-moved': 'moved', edited: 'edited', confirmed: 'confirmed', rejected: 'rejected', draft: 'reopened' };
const ok = (r) => { if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; } return r.data; };

export function anonClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function userClient(env, token) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const sheetOut = (r) => ({ id: r.id, drawingId: r.drawing_set_id, projectId: r.project_id, page: r.page_index, number: r.sheet_number, title: r.title, width: +r.width_pt, height: +r.height_pt, ptsPerFoot: r.scale_pts_per_ft == null ? null : +r.scale_pts_per_ft, ...(r.text_items ? { items: r.text_items } : {}) });
const MK = 'id,project_id,capture_id,sheet_id,status,cloud_rect,callout_rect,text,ai_method,ai_confidence,ai_reasoning,ai_anchor_text,created_by,created_at,confirmed_by,confirmed_at,rejected_by,sheets(page_index,drawing_set_id,sheet_number,title),captures(captured_at,captured_by,note_text)';
const mkOut = (r) => ({
  id: r.id, projectId: r.project_id, captureId: r.capture_id, sheetId: r.sheet_id, page: r.sheets?.page_index, drawingId: r.sheets?.drawing_set_id,
  sheetNumber: r.sheets?.sheet_number, sheetTitle: r.sheets?.title, status: r.status, cloud: r.cloud_rect, callout: r.callout_rect, text: r.text,
  confidence: r.ai_confidence == null ? 0 : +r.ai_confidence, method: r.ai_method, reasoning: r.ai_reasoning, anchorText: r.ai_anchor_text,
  createdBy: r.created_by, createdAt: r.created_at, confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at, rejectedBy: r.rejected_by,
  capturedAt: r.captures?.captured_at || r.created_at, capturedBy: r.captures?.captured_by || r.created_by, note: r.captures?.note_text,
});

export function supabaseStore(sb, uid) {
  return {
    kind: 'supabase',
    async me() {
      const [mem, prof] = await Promise.all([
        sb.from('memberships').select('org_id,role,organizations(name)').eq('user_id', uid),
        sb.from('profiles').select('email,display_name,initials').eq('user_id', uid).maybeSingle(),
      ]);
      return { memberships: ok(mem).map((m) => ({ orgId: m.org_id, role: m.role, orgName: m.organizations?.name })), profile: ok(prof) };
    },
    async listProjects() {
      return ok(await sb.from('projects').select('id,org_id,name,number,status,created_at').order('created_at')).map((p) => ({ id: p.id, orgId: p.org_id, name: p.name, number: p.number, status: p.status }));
    },
    async getProject(pid) {
      const p = ok(await sb.from('projects').select('id,org_id,name,number').eq('id', pid).maybeSingle());
      return p && { id: p.id, orgId: p.org_id, name: p.name, number: p.number };
    },
    async createProject(orgId, name, number) {
      const p = ok(await sb.from('projects').insert({ org_id: orgId, name, number: number || null }).select('id,org_id,name,number').single());
      return { id: p.id, orgId: p.org_id, name: p.name, number: p.number };
    },
    async projectState(pid) {
      const [drawings, sheets, captures, markups, people] = await Promise.all([
        sb.from('drawing_sets').select('id,name,revision,page_count,uploaded_at,superseded_by').eq('project_id', pid).order('uploaded_at', { ascending: false }),
        sb.from('sheets').select('id,drawing_set_id,project_id,page_index,sheet_number,title,width_pt,height_pt,scale_pts_per_ft').eq('project_id', pid).order('page_index'),
        sb.from('captures').select('id,sheet_id,note_text,note_source,captured_at,captured_by,client_id').eq('project_id', pid).order('captured_at'),
        sb.from('markups').select(MK).eq('project_id', pid).order('created_at'),
        sb.from('profiles').select('user_id,email,display_name,initials'),
      ]);
      return {
        drawings: ok(drawings).map((d) => ({ id: d.id, name: d.name, revision: d.revision, pages: d.page_count, uploadedAt: d.uploaded_at, supersededBy: d.superseded_by })),
        sheets: ok(sheets).map(sheetOut),
        captures: ok(captures).map((c) => ({ id: c.id, sheetId: c.sheet_id, note: c.note_text, noteSource: c.note_source, capturedAt: c.captured_at, capturedBy: c.captured_by, clientId: c.client_id })),
        markups: ok(markups).map(mkOut),
        people: Object.fromEntries(ok(people).map((p) => [p.user_id, { email: p.email, name: p.display_name, initials: p.initials }])),
      };
    },
    async addDrawingSet(project, name, bytes, sheets) {
      const ds = ok(await sb.from('drawing_sets').insert({ project_id: project.id, name, storage_path: 'pending', page_count: sheets.length, uploaded_by: uid }).select('id').single());
      const key = `${project.orgId}/${project.id}/drawings/${ds.id}.pdf`;
      ok(await sb.storage.from('drawings').upload(key, bytes, { contentType: 'application/pdf', upsert: true }));
      ok(await sb.from('drawing_sets').update({ storage_path: key }).eq('id', ds.id));
      ok(await sb.from('sheets').insert(sheets.map((s) => ({ drawing_set_id: ds.id, project_id: project.id, page_index: s.page, sheet_number: s.number, title: s.title, width_pt: s.width, height_pt: s.height, scale_pts_per_ft: s.ptsPerFoot, text_items: s.items }))));
      return ds.id;
    },
    async getDrawingSet(did) {
      const d = ok(await sb.from('drawing_sets').select('id,project_id,name,storage_path').eq('id', did).maybeSingle());
      return d && { id: d.id, projectId: d.project_id, name: d.name, path: d.storage_path };
    },
    async getDrawingBytes(did) {
      const d = await this.getDrawingSet(did); if (!d) return null;
      const blob = ok(await sb.storage.from('drawings').download(d.path));
      return Buffer.from(await blob.arrayBuffer());
    },
    async getSheet(sid) {
      const r = ok(await sb.from('sheets').select('*').eq('id', sid).maybeSingle());
      return r && sheetOut(r);
    },
    async findCaptureByClientId(clientId) {
      const c = ok(await sb.from('captures').select('id,sheet_id,note_text,note_source,captured_at,client_id').eq('client_id', clientId).maybeSingle());
      if (!c) return null;
      const m = ok(await sb.from('markups').select(MK).eq('capture_id', c.id).order('created_at').limit(1));
      return { capture: { id: c.id, sheetId: c.sheet_id, note: c.note_text, capturedAt: c.captured_at, clientId: c.client_id }, markup: m[0] ? mkOut(m[0]) : null };
    },
    async addCapture({ project, sheetId, note, noteSource, photoBytes, photoMime, ext, clientId, capturedAt }) {
      const row = { project_id: project.id, sheet_id: sheetId, captured_by: uid, note_text: note, note_source: noteSource === 'voice' ? 'voice' : 'text' };
      if (clientId) row.client_id = clientId;
      if (capturedAt) row.captured_at = capturedAt;
      const c = ok(await sb.from('captures').insert(row).select('id,captured_at').single());
      const key = `${project.orgId}/${project.id}/photos/${c.id}${ext}`;
      ok(await sb.storage.from('photos').upload(key, photoBytes, { contentType: photoMime, upsert: true }));
      ok(await sb.from('capture_photos').insert({ capture_id: c.id, storage_path: key, mime: photoMime }));
      return { id: c.id, sheetId, note, noteSource, capturedAt: c.captured_at, clientId };
    },
    async getPhoto(cid) {
      const rows = ok(await sb.from('capture_photos').select('storage_path,mime').eq('capture_id', cid).order('ord').limit(1));
      if (!rows.length) return null;
      const blob = ok(await sb.storage.from('photos').download(rows[0].storage_path));
      return { bytes: Buffer.from(await blob.arrayBuffer()), mime: rows[0].mime };
    },
    async addMarkup(m) {
      const r = ok(await sb.from('markups').insert({ project_id: m.projectId, sheet_id: m.sheetId, capture_id: m.captureId, status: 'draft', cloud_rect: m.cloud, callout_rect: m.callout, text: m.text, ai_method: m.method, ai_model: m.method?.startsWith('llm:') ? m.method.slice(4) : null, ai_confidence: m.confidence, ai_reasoning: m.reasoning, ai_anchor_text: m.anchorText, ai_tokens_in: m.usage?.input ?? null, ai_tokens_out: m.usage?.output ?? null, created_by: uid }).select(MK).single());
      ok(await sb.from('markup_events').insert({ markup_id: r.id, actor_id: uid, action: 'suggested', after: { cloud: m.cloud, callout: m.callout, text: m.text, method: m.method } }));
      return mkOut(r);
    },
    async getMarkup(mid) { const r = ok(await sb.from('markups').select(MK).eq('id', mid).maybeSingle()); return r && mkOut(r); },
    async updateMarkup(mid, fields, actions) {
      const before = await this.getMarkup(mid); if (!before) return null;
      const upd = {};
      if (fields.cloud) upd.cloud_rect = fields.cloud;
      if (fields.callout) upd.callout_rect = fields.callout;
      if (typeof fields.text === 'string') upd.text = fields.text;
      if (fields.status) {
        upd.status = fields.status;
        if (fields.status === 'confirmed') { upd.confirmed_by = uid; upd.confirmed_at = new Date().toISOString(); }
        if (fields.status === 'rejected') upd.rejected_by = uid;
        if (fields.status === 'draft') { upd.confirmed_by = null; upd.confirmed_at = null; upd.rejected_by = null; }
      }
      const rows = ok(await sb.from('markups').update(upd).eq('id', mid).select(MK));
      if (!rows.length) { const e = new Error('not allowed for your role'); e.status = 403; throw e; }
      const evs = [...new Set(actions.map((a) => ACTION[a]).filter(Boolean))].map((action) => ({ markup_id: mid, actor_id: uid, action, before: { cloud: before.cloud, callout: before.callout, text: before.text, status: before.status }, after: upd }));
      if (evs.length) ok(await sb.from('markup_events').insert(evs));
      return mkOut(rows[0]);
    },
    async listMarkups(pid, statuses, { drawingId, sheetId } = {}) {
      let q = sb.from('markups').select(MK).eq('project_id', pid).in('status', statuses);
      if (sheetId) q = q.eq('sheet_id', sheetId);
      let rows = ok(await q.order('created_at')).map(mkOut);
      if (drawingId) rows = rows.filter((m) => m.drawingId === drawingId);
      return rows.sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : 0));
    },
    async people() { return Object.fromEntries(ok(await sb.from('profiles').select('user_id,email,display_name,initials')).map((p) => [p.user_id, { email: p.email, name: p.display_name, initials: p.initials }])); },
    async logExport(pid, sheetIds, includeDrafts, count) {
      ok(await sb.from('exports').insert({ project_id: pid, requested_by: uid, sheet_ids: sheetIds, include_drafts: includeDrafts, markup_count: count }));
    },
    async resetProject(project) {
      ok(await sb.from('markups').delete().eq('project_id', project.id));
      ok(await sb.from('captures').delete().eq('project_id', project.id));
      ok(await sb.from('exports').delete().eq('project_id', project.id));
      ok(await sb.from('drawing_sets').delete().eq('project_id', project.id));
      for (const [bucket, sub] of [['drawings', 'drawings'], ['photos', 'photos']]) {
        const prefix = `${project.orgId}/${project.id}/${sub}`;
        const files = ok(await sb.storage.from(bucket).list(prefix, { limit: 1000 }));
        if (files.length) ok(await sb.storage.from(bucket).remove(files.map((f) => `${prefix}/${f.name}`)));
      }
    },
    async monthSpend() { return +ok(await sb.rpc('ai_month_spend')); },
    async logAiUsage(u) {
      ok(await sb.from('ai_usage').insert({ org_id: u.orgId, project_id: u.projectId, capture_id: u.captureId, model: u.model, route: u.route, tokens_in: u.tokensIn, tokens_in_cached: u.tokensInCached, tokens_out: u.tokensOut, est_cost_usd: u.estCost, gateway_cost_usd: u.gatewayCost, ok: u.ok, error: u.error, latency_ms: u.latencyMs }));
    },
  };
}
