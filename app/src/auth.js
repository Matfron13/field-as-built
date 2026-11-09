import { createClient } from '@supabase/supabase-js';
let sbp;
// Supabase URL + publishable key come from the server (cached so the app can start offline).
export function supabase() {
  return (sbp ||= (async () => {
    let cfg = null;
    try { cfg = await (await fetch('/api/public-config')).json(); localStorage.setItem('fab-public-config', JSON.stringify(cfg)); }
    catch { cfg = JSON.parse(localStorage.getItem('fab-public-config') || 'null'); }
    if (!cfg) throw new Error('Offline and never signed in on this device.');
    return createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fab-auth' } });
  })());
}
export async function token() { const sb = await supabase(); const { data } = await sb.auth.getSession(); return data.session?.access_token || null; }
export async function authFetch(url, opts = {}) {
  const t = await token();
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) } });
  if (r.status === 401) { window.dispatchEvent(new Event('fab-signed-out')); }
  return r;
}
export async function api(url, opts) {
  const r = await authFetch(url, opts);
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || r.statusText), { status: r.status });
  return r.json();
}
