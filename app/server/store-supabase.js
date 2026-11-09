// Supabase store: Postgres tables + private Storage buckets, accessed as the seeded demo user so RLS applies.
// No auth in the MVP yet: the server signs in as one demo admin (FAB_DEMO_EMAIL / FAB_DEMO_PASSWORD, server-only env).
import { createClient } from '@supabase/supabase-js';

const ACTION = { moved: 'moved', 'callout-moved': 'moved', edited: 'edited', confirmed: 'confirmed', rejected: 'rejected', draft: 'reopened' };

export function supabaseStore(env) {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ORG = env.FAB_DEMO_ORG_ID, PROJ = env.FAB_DEMO_PROJECT_ID;
  let exp = 0, uid = null;
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  async function auth() {
    if (Date.now() / 1000 < exp - 120) return;
    const { data, error } = await sb.auth.signInWithPassword({ email: env.FAB_DEMO_EMAIL, password: env.FAB_DEMO_PASSWORD });
    if (error) throw new Error(`demo sign-in failed: ${error.message}`);
    exp = data.session.expires_at; uid = data.user.id;
  }
  const prefix = `${ORG}/${PROJ}`;
  const sheetOut = (r) => ({ id: r.id, drawingId: r.drawing_set_id, page: r.page_index, number: r.sheet_number, title: r.title, width: +r.width_pt, height: +r.height_pt, ptsPerFoot: r.scale_pts_per_ft == null ? null : +r.scale_pts_per_ft, ...(r.text_items ? { items: r.text_items } : {}) });
  const mkOut = (r) => ({ id: r.id, captureId: r.capture_id, sheetId: r.sheet_id, page: r.sheets?.page_index, status: r.status, cloud: r.cloud_rect, callout: r.callout_rect, text: r.text, confidence: r.ai_confidence == null ? 0 : +r.ai_confidence, method: r.ai_method, reasoning: r.ai_reasoning, anchorText: r.ai_anchor_text, createdAt: r.created_at, confirmedAt: r.confirmed_at, author: 'MF (Field As-Built)' });
  const MK = 'id,capture_id,sheet_id,status,cloud_rect,callout_rect,text,ai_method,ai_confidence,ai_reasoning,ai_anchor_text,created_at,confirmed_at,sheets(page_index)';

  async function clearProject() {
    ok(await sb.from('markups').delete().eq('project_id', PROJ));
    ok(await sb.from('captures').delete().eq('project_id', PROJ));
    ok(await sb.from('drawing_sets').delete().eq('project_id', PROJ));
    for (const bucket of ['drawings', 'photos']) {
      const files = ok(await sb.storage.from(bucket).list(prefix, { limit: 1000 }));
      if (files.length) ok(await sb.storage.from(bucket).remove(files.map((f) => `${prefix}/${f.name}`)));
    }
  }

  return {
    kind: 'supabase',
    async getState() {
      await auth();
      const [project, drawings, sheets, captures, markups] = await Promise.all([
        sb.from('projects').select('id,name').eq('id', PROJ).single(),
        sb.from('drawing_sets').select('id,name,page_count,uploaded_at').eq('project_id', PROJ).is('superseded_by', null).order('uploaded_at', { ascending: false }),
        sb.from('sheets').select('id,drawing_set_id,page_index,sheet_number,title,width_pt,height_pt,scale_pts_per_ft').eq('project_id', PROJ).order('page_index'),
        sb.from('captures').select('id,sheet_id,note_text,note_source,captured_at').eq('project_id', PROJ).order('captured_at'),
        sb.from('markups').select(MK).eq('project_id', PROJ).order('created_at'),
      ]);
      return {
        project: ok(project),
        drawings: ok(drawings).map((d) => ({ id: d.id, name: d.name, pages: d.page_count, uploadedAt: d.uploaded_at })),
        sheets: ok(sheets).map(sheetOut),
        captures: ok(captures).map((c) => ({ id: c.id, sheetId: c.sheet_id, note: c.note_text, noteSource: c.note_source, createdAt: c.captured_at })),
        markups: ok(markups).map(mkOut),
      };
    },
    async replaceDrawing(name, bytes, sheets) {
      await auth(); await clearProject();
      const ds = ok(await sb.from('drawing_sets').insert({ project_id: PROJ, name, storage_path: 'pending', page_count: sheets.length, uploaded_by: uid }).select('id').single());
      const pathKey = `${prefix}/${ds.id}.pdf`;
      ok(await sb.storage.from('drawings').upload(pathKey, bytes, { contentType: 'application/pdf', upsert: true }));
      ok(await sb.from('drawing_sets').update({ storage_path: pathKey }).eq('id', ds.id));
      ok(await sb.from('sheets').insert(sheets.map((s) => ({ drawing_set_id: ds.id, project_id: PROJ, page_index: s.page, sheet_number: s.number, title: s.title, width_pt: s.width, height_pt: s.height, scale_pts_per_ft: s.ptsPerFoot, text_items: s.items }))));
    },
    async getDrawing(did) {
      await auth();
      let q = sb.from('drawing_sets').select('storage_path').eq('project_id', PROJ).is('superseded_by', null);
      if (did) q = q.eq('id', did);
      const rows = ok(await q.limit(1)); if (!rows.length) return null;
      const blob = ok(await sb.storage.from('drawings').download(rows[0].storage_path));
      return Buffer.from(await blob.arrayBuffer());
    },
    async getSheet(sid) {
      await auth();
      const r = ok(await sb.from('sheets').select('*').eq('id', sid).maybeSingle());
      return r && sheetOut(r);
    },
    async addCapture({ sheetId, note, noteSource, photoBytes, photoMime, ext }) {
      await auth();
      const c = ok(await sb.from('captures').insert({ project_id: PROJ, sheet_id: sheetId, captured_by: uid, note_text: note, note_source: noteSource === 'voice' ? 'voice' : 'text' }).select('id,captured_at').single());
      const key = `${prefix}/${c.id}${ext}`;
      ok(await sb.storage.from('photos').upload(key, photoBytes, { contentType: photoMime, upsert: true }));
      ok(await sb.from('capture_photos').insert({ capture_id: c.id, storage_path: key, mime: photoMime }));
      return { id: c.id, sheetId, note, noteSource, createdAt: c.captured_at };
    },
    async getPhoto(cid) {
      await auth();
      const rows = ok(await sb.from('capture_photos').select('storage_path,mime').eq('capture_id', cid).order('ord').limit(1));
      if (!rows.length) return null;
      const blob = ok(await sb.storage.from('photos').download(rows[0].storage_path));
      return { bytes: Buffer.from(await blob.arrayBuffer()), mime: rows[0].mime };
    },
    async addMarkup(m) {
      await auth();
      const r = ok(await sb.from('markups').insert({ project_id: PROJ, sheet_id: m.sheetId, capture_id: m.captureId, status: 'draft', cloud_rect: m.cloud, callout_rect: m.callout, text: m.text, ai_method: m.method, ai_model: m.method?.startsWith('llm:') ? m.method.slice(4) : null, ai_confidence: m.confidence, ai_reasoning: m.reasoning, ai_anchor_text: m.anchorText, ai_tokens_in: m.usage?.input ?? null, ai_tokens_out: m.usage?.output ?? null, created_by: uid }).select(MK).single());
      ok(await sb.from('markup_events').insert({ markup_id: r.id, actor_id: uid, action: 'suggested', after: { cloud: m.cloud, callout: m.callout, text: m.text, method: m.method } }));
      return mkOut(r);
    },
    async updateMarkup(mid, fields, actions) {
      await auth();
      const before = ok(await sb.from('markups').select(MK).eq('id', mid).maybeSingle()); if (!before) return null;
      const upd = {};
      if (fields.cloud) upd.cloud_rect = fields.cloud;
      if (fields.callout) upd.callout_rect = fields.callout;
      if (typeof fields.text === 'string') upd.text = fields.text;
      if (fields.status) {
        upd.status = fields.status;
        if (fields.status === 'confirmed') { upd.confirmed_by = uid; upd.confirmed_at = new Date().toISOString(); }
        if (fields.status === 'rejected') { upd.rejected_by = uid; }
      }
      const r = ok(await sb.from('markups').update(upd).eq('id', mid).select(MK).single());
      const evs = [...new Set(actions.map((a) => ACTION[a]).filter(Boolean))].map((action) => ({ markup_id: mid, actor_id: uid, action, before: { cloud: before.cloud_rect, callout: before.callout_rect, text: before.text, status: before.status }, after: upd }));
      if (evs.length) ok(await sb.from('markup_events').insert(evs));
      return mkOut(r);
    },
    async listMarkups(statuses) {
      await auth();
      return ok(await sb.from('markups').select(MK).eq('project_id', PROJ).in('status', statuses)).map(mkOut);
    },
    async reset() { await auth(); await clearProject(); },
  };
}
