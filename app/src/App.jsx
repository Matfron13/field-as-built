import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SheetViewer from './SheetViewer.jsx';
import SheetPicker from './SheetPicker.jsx';
import Brand from './Brand.jsx';
import { supabase, api, authFetch } from './auth.js';
import { outbox, cache, uuid } from './offline.js';

const pct = (x) => `${Math.round(x * 100)}%`;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
async function shrinkPhoto(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1.5e6) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
function AuthedImg({ src, ...p }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let u; let live = true; authFetch(src).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && live) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => {}); return () => { live = false; if (u) URL.revokeObjectURL(u); }; }, [src]);
  return url ? <img src={url} {...p} /> : <div className="imgph" />;
}
async function download(url, fallbackName) {
  const r = await authFetch(url); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'export failed');
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return { name, count: r.headers.get('x-markup-count') };
}

function Login() {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const sb = await supabase(); const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw }); if (error) throw error; }
    catch (x) { setErr(x.message === 'Invalid login credentials' ? 'Wrong email or password.' : x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form onSubmit={go} data-testid="login-form">
        <Brand big mark={40} />
        <div className="muted small">Sign in. Accounts are invite-only; ask your admin for access.</div>
        <input type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" required />
        <input type="password" autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="login-password" required />
        <button className="primary" disabled={busy} data-testid="login-submit">{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <div className="err" data-testid="login-error">{err}</div>}
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    let unsub = () => {};
    supabase().then(async (sb) => {
      setSession((await sb.auth.getSession()).data.session);
      unsub = sb.auth.onAuthStateChange((_e, s) => setSession(s)).data.subscription.unsubscribe;
    }).catch(() => setSession(null));
    const out = () => supabase().then((sb) => sb.auth.getSession()).then(({ data }) => { if (!data.session) setSession(null); });
    window.addEventListener('fab-signed-out', out);
    return () => { unsub(); window.removeEventListener('fab-signed-out', out); };
  }, []);
  if (session === undefined) return <div className="empty">Loading…</div>;
  if (!session) return <Login />;
  return <Workspace key={session.user.id} user={session.user} />;
}

function Workspace({ user }) {
  const [me, setMe] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [pid, setPid] = useState(() => localStorage.getItem('fab-project') || null);
  const [st, setSt] = useState(null);
  const [sheetId, setSheetId] = useState(null);
  const [recent, setRecent] = useState(() => JSON.parse(localStorage.getItem('fab-recent-sheets') || '[]'));
  const [photo, setPhoto] = useState(null);
  const [note, setNote] = useState('');
  const [noteSource, setNoteSource] = useState('text');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [listening, setListening] = useState(false);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [exportScope, setExportScope] = useState('set');
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState([]);
  const [tab, setTab] = useState('capture');
  const recRef = useRef(null); const syncing = useRef(false);

  const run = async (label, fn) => { setBusy(label); setErr(''); setMsg(''); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(''); } };
  const loadMe = useCallback(async () => {
    try { const m = await api('/api/me'); setMe(m); cache.set(`me:${user.id}`, m); return m; }
    catch (e) { const c = await cache.get(`me:${user.id}`); if (c) { setMe(c); return c; } throw e; }
  }, [user.id]);
  const loadState = useCallback(async (p = pid) => {
    if (!p) { setSt(null); return; }
    let s;
    try { s = await api(`/api/projects/${p}/state`); cache.set(`state:${user.id}:${p}`, s); }
    catch (e) { s = await cache.get(`state:${user.id}:${p}`); if (!s) throw e; s = { ...s, stale: true }; }
    setSt(s);
    setSheetId((cur) => (cur && s.sheets.find((x) => x.id === cur) ? cur : s.sheets.find((x) => s.drawings.some((d) => d.id === x.drawingId && !d.supersededBy))?.id || null));
  }, [pid, user.id]);
  const refreshPending = useCallback(async () => setPending((await outbox.all()).filter((x) => x.userId === user.id)), [user.id]);

  useEffect(() => {
    loadMe().then((m) => { const ok = m.projects.find((p) => p.id === pid); if (!ok) setPid(m.projects[0]?.id || null); }).catch((e) => setErr(e.message));
    api('/api/config').then(setCfg).catch(() => {});
    refreshPending();
  }, []); // eslint-disable-line
  useEffect(() => { if (pid) localStorage.setItem('fab-project', pid); setSelectedId(null); loadState(pid).catch((e) => setErr(e.message)); }, [pid]); // eslint-disable-line

  // ---- offline outbox sync
  const sync = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return; syncing.current = true;
    try {
      const items = (await outbox.all()).filter((x) => x.userId === user.id);
      let done = 0;
      for (const it of items) {
        const fd = new FormData();
        fd.append('photo', new File([it.photo], it.photoName || 'photo.jpg', { type: it.photo.type || 'image/jpeg' }));
        Object.entries({ note: it.note, sheetId: it.sheetId, noteSource: it.noteSource, clientId: it.clientId, capturedAt: it.capturedAt, ...(it.mode ? { mode: it.mode } : {}) }).forEach(([k, v]) => fd.append(k, v));
        try { await api('/api/captures', { method: 'POST', body: fd }); await outbox.remove(it.clientId); done++; }
        catch (e) { if (e.status && e.status < 500 && e.status !== 401) { await outbox.update(it.clientId, { error: e.message }); } else break; }
      }
      if (done) { await loadState(); api('/api/config').then(setCfg).catch(() => {}); setMsg(`Synced ${done} offline capture${done > 1 ? 's' : ''}.`); }
    } finally { syncing.current = false; refreshPending(); }
  }, [user.id, loadState, refreshPending]);
  useEffect(() => {
    const on = () => { setOnline(true); sync(); }, off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const t = setInterval(() => sync(), 30000); sync();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); };
  }, [sync]);

  const project = st?.project; const role = st?.role || me?.memberships?.[0]?.role; const canReview = !!st?.canReview;
  const isForeman = role === 'foreman';
  const sheet = st?.sheets.find((s) => s.id === sheetId);
  const liveSets = (st?.drawings || []).filter((d) => !d.supersededBy);
  const drawing = st?.drawings.find((d) => d.id === sheet?.drawingId) || liveSets[0];
  const markups = st?.markups || [];
  const visibleQueue = useMemo(() => {
    const ms = isForeman ? markups.filter((m) => m.createdBy === user.id) : markups;
    return [...ms].sort((a, b) => (a.status === 'draft' ? 0 : 1) - (b.status === 'draft' ? 0 : 1) || (b.capturedAt || '').localeCompare(a.capturedAt || ''));
  }, [markups, isForeman, user.id]);
  const selected = markups.find((m) => m.id === selectedId);
  const counts = markups.reduce((a, m) => ({ ...a, [m.status]: (a[m.status] || 0) + 1 }), {});
  const canEdit = (m) => canReview || (m.createdBy === user.id && m.status === 'draft');
  const pickSheet = (id) => { setSheetId(id); const r = [id, ...recent.filter((x) => x !== id)].slice(0, 6); setRecent(r); localStorage.setItem('fab-recent-sheets', JSON.stringify(r)); };

  const loadDrawing = useCallback(async (did) => {
    const key = `pdf:${user.id}:${did}`;
    try { const r = await authFetch(`/api/drawings/${did}/file`); if (!r.ok) throw new Error('drawing download failed'); const b = new Uint8Array(await r.arrayBuffer()); cache.set(key, b); return b; }
    catch (e) { const c = await cache.get(key); if (c) return c; throw e; }
  }, [user.id]);

  const createProject = () => run('Creating project…', async () => {
    const name = prompt('Project name'); if (!name?.trim()) return;
    const p = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    await loadMe(); setPid(p.id);
  });
  const uploadPdf = (f) => run('Reading drawing set…', async () => { if (f.size > 4.4e6) throw new Error('Drawing PDFs up to 4.4 MB for now (serverless upload limit). Split larger sets.'); const fd = new FormData(); fd.append('pdf', f); await api(`/api/projects/${pid}/drawings`, { method: 'POST', body: fd }); await loadState(); });
  const loadSample = () => run('Adding sample set…', async () => { await api(`/api/projects/${pid}/sample`, { method: 'POST' }); await loadState(); });
  const useSamplePhoto = async () => { const b = await (await authFetch('/api/sample/photo')).blob(); setPhoto(new File([b], 'sample-field-photo-LP1.jpg', { type: 'image/jpeg' })); if (!note) { setNote('Panel LP-1 relocated 3 ft north to clear duct, conduits re-stubbed above'); setNoteSource('text'); } };

  const toggleMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr('Voice notes need a browser with Web Speech (Chrome/Safari). Type the note instead.'); return; }
    if (listening) { recRef.current?.stop(); return; }
    const r = new SR(); r.lang = 'en-US'; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => { setNote(Array.from(e.results).map((x) => x[0].transcript).join(' ')); setNoteSource('voice'); };
    r.onend = () => setListening(false); r.onerror = (e) => { setErr(`Mic: ${e.error}`); setListening(false); };
    recRef.current = r; r.start(); setListening(true);
  };

  // Every capture goes to the IndexedDB outbox first, then syncs (immediately when online).
  const capture = () => run(navigator.onLine ? (cfg?.placement === 'llm' ? 'Saving + asking AI for a placement…' : 'Saving + suggesting placement…') : 'Saved offline…', async () => {
    const p = await shrinkPhoto(photo);
    const item = { ...(localStorage.getItem('fab-force-stub') ? { mode: 'stub' } : {}), clientId: uuid(), userId: user.id, projectId: pid, sheetId, sheetLabel: sheet ? `${sheet.number} ${sheet.title}` : '', note, noteSource, photo: p, photoName: p.name, capturedAt: new Date().toISOString() };
    await outbox.add(item); setPhoto(null); setNote(''); await refreshPending();
    if (!navigator.onLine) { setMsg('No signal: capture saved on this phone. It will sync and get a draft markup when you are back online.'); return; }
    await sync();
    const st2 = await api(`/api/projects/${pid}/state`).catch(() => null);
    const m = st2?.markups.find((x) => st2.captures.find((c) => c.clientId === item.clientId)?.id === x.captureId);
    if (m) setSelectedId(m.id);
  });
  const patch = (id, body) => run('', async () => { await api(`/api/markups/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await loadState(); });
  const qs = () => `statuses=${includeDrafts ? 'confirmed,draft' : 'confirmed'}&tz=${encodeURIComponent(TZ)}&${exportScope === 'sheet' && sheet ? `sheetId=${sheet.id}` : `drawingId=${drawing?.id}`}`;
  const exportPdf = () => run('Exporting PDF…', async () => { const r = await download(`/api/projects/${pid}/export.pdf?${qs()}`, 'as-built.pdf'); setMsg(`Exported ${r.count} markup(s): ${r.name}`); });
  const exportCsv = () => run('Exporting CSV…', async () => { const r = await download(`/api/projects/${pid}/markups.csv?${qs().replace(/drawingId=[^&]*/, exportScope === 'sheet' ? '' : `drawingId=${drawing?.id}`)}`, 'markup-log.csv'); setMsg(`Markup log: ${r.count} row(s): ${r.name}`); });
  const reset = () => run('Clearing project…', async () => { if (!confirm('Delete all drawings, captures and markups in this project?')) return; await api(`/api/projects/${pid}/reset`, { method: 'POST' }); setSelectedId(null); await loadState(); });
  const signOut = async () => { await cache.clear(); localStorage.removeItem('fab-project'); (await supabase()).auth.signOut(); };

  // Review queue grouped by capture date
  const groups = useMemo(() => { const g = []; for (const m of visibleQueue) { const k = new Date(m.capturedAt).toDateString(); let last = g[g.length - 1]; if (!last || last.k !== k) g.push(last = { k, label: fmtDay(m.capturedAt), items: [] }); last.items.push(m); } return g; }, [visibleQueue]);
  const pendingHere = pending.filter((x) => x.projectId === pid);

  return (
    <div className="app">
      <header>
        <Brand />
        <select className="projsel" value={pid || ''} onChange={(e) => setPid(e.target.value)} data-testid="project-select">
          {!me?.projects?.length && <option value="">No projects</option>}
          {me?.projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {me?.memberships?.some((m) => m.role !== 'foreman') && <button className="hdrbtn" onClick={createProject} data-testid="new-project">+ Project</button>}
        <span className="rolechip" data-testid="role">{role === 'pe' ? 'PE' : role === 'admin' ? 'Admin' : role === 'foreman' ? 'Foreman' : ''}</span>
        <span className={`net ${online ? 'on' : 'off'}`} data-testid="net">{online ? 'Online' : 'Offline'}{pending.length ? ` · ${pending.length} to sync` : ''}</span>
        <div className={`mode ${cfg?.placement}`} data-testid="placement-mode">
          {cfg?.placement === 'llm' ? `AI placement · $${(cfg.monthSpendUsd || 0).toFixed(2)} of $${cfg.capUsd.toFixed(2)} this month`
            : cfg?.capped ? `AI paused (cap $${cfg.capUsd.toFixed(2)}): text-match placement` : 'Placement: text match (no AI)'}
        </div>
        <button className="hdrbtn right" onClick={signOut} data-testid="sign-out" title={user.email}>Sign out</button>
      </header>
      {st && <nav className="tabs"><button className={tab === 'capture' ? 'on' : ''} onClick={() => setTab('capture')}>Capture</button><button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>Sheet</button></nav>}
      <div className={`body tab-${tab}`}>
        <aside>
          {st?.stale && <div className="warn small">Offline: showing the last copy saved on this device.</div>}
          {!pid && <section><div className="muted">{me ? 'You are not on any project yet. Ask a PE or admin to add one.' : 'Loading…'}</div></section>}
          {pid && (
            <section>
              <h3>Sheet</h3>
              <SheetPicker sheets={st?.sheets || []} drawings={st?.drawings || []} sheetId={sheetId} recent={recent} onPick={pickSheet} />
              {canReview && (
                <div className="row">
                  <label className="btn">Add drawing set (PDF)<input type="file" accept="application/pdf" hidden data-testid="pdf-input" onChange={(e) => e.target.files[0] && uploadPdf(e.target.files[0])} /></label>
                  <button onClick={loadSample} data-testid="load-sample">Add sample set</button>
                </div>
              )}
              {liveSets.length > 0 && <div className="muted tiny">{liveSets.length} drawing set{liveSets.length > 1 ? 's' : ''}: {liveSets.map((d) => d.name).join(' · ')}</div>}
            </section>
          )}

          {pid && (
            <section>
              <h3>Capture a field change</h3>
              <div className="muted small">On: <b>{sheet ? `${sheet.number} ${sheet.title}` : '—'}</b></div>
              <div className="row">
                <label className="btn big">{photo ? 'Retake photo' : '📷 Photo'}<input type="file" accept="image/*" capture="environment" hidden data-testid="photo-input" onChange={(e) => { if (e.target.files[0]) setPhoto(e.target.files[0]); e.target.value = ''; }} /></label>
                <button onClick={useSamplePhoto} data-testid="sample-photo">Use sample photo</button>
              </div>
              {photo && <img className="thumb" src={URL.createObjectURL(photo)} alt="capture" />}
              <div className="row"><textarea rows={3} placeholder='Note, e.g. "LP-1 moved 3 ft north to clear duct"' value={note} onChange={(e) => { setNote(e.target.value); setNoteSource('text'); }} data-testid="note" /></div>
              <div className="row">
                <button onClick={toggleMic} className={listening ? 'rec' : ''}>{listening ? '■ Stop' : '🎤 Voice'}</button>
                <button className="primary grow" disabled={!photo || !note.trim() || !sheet || !!busy} onClick={capture} data-testid="suggest">{online ? 'Save + suggest placement' : 'Save offline'}</button>
              </div>
              {pendingHere.length > 0 && (
                <div className="outbox" data-testid="outbox">
                  <div className="small"><b>{pendingHere.length} waiting to sync</b> {online && <button onClick={sync}>Sync now</button>}</div>
                  {pendingHere.map((x) => <div key={x.clientId} className="tiny muted">{new Date(x.capturedAt).toLocaleTimeString()} · {x.sheetLabel} · {x.note.slice(0, 50)}{x.error ? ` · ⚠ ${x.error}` : ''}</div>)}
                </div>
              )}
            </section>
          )}

          {pid && (
            <section>
              <h3>{canReview ? 'Review queue' : 'My captures'} <span className="muted small">({counts.draft || 0} draft · {counts.confirmed || 0} confirmed · {counts.rejected || 0} rejected)</span></h3>
              {visibleQueue.length === 0 && <div className="muted small">No markups yet.</div>}
              {groups.map((g) => (
                <div key={g.k}>
                  <div className="daygroup">{g.label}</div>
                  {g.items.map((m) => (
                    <div key={m.id} className={`qi ${m.status} ${m.id === selectedId ? 'sel' : ''}`} onClick={() => { setSelectedId(m.id); setSheetId(m.sheetId); setTab('sheet'); }} data-testid={`queue-${m.id}`}>
                      <AuthedImg src={`/api/captures/${m.captureId}/photo`} alt="" />
                      <div className="qt">
                        <div className="small"><b>{m.sheetNumber}</b> · <span className={`st ${m.status}`}>{m.status}</span> · conf {pct(m.confidence)} {m.confidence < 0.5 && <span className="low">LOW</span>}</div>
                        <div className="small">{m.text}</div>
                        <div className="muted tiny">{st.people?.[m.capturedBy]?.initials || ''} · {new Date(m.capturedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {m.method}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          )}

          {selected && (
            <section className="detail">
              <h3>Selected markup</h3>
              <textarea rows={3} defaultValue={selected.text} key={selected.id + selected.text} disabled={!canEdit(selected)} onBlur={(e) => e.target.value !== selected.text && patch(selected.id, { text: e.target.value })} data-testid="markup-text" />
              <div className="muted tiny">Why here: {selected.reasoning}</div>
              {canReview ? (
                <div className="row">
                  <button className="primary" onClick={() => patch(selected.id, { status: 'confirmed' })} data-testid="confirm">✓ Confirm</button>
                  <button onClick={() => patch(selected.id, { status: 'rejected' })} data-testid="reject">✕ Reject</button>
                  {selected.status !== 'draft' && <button onClick={() => patch(selected.id, { status: 'draft' })}>Back to draft</button>}
                </div>
              ) : <div className="muted tiny">{selected.status === 'draft' ? 'You can drag your draft into place. A PE confirms it.' : `This markup is ${selected.status}.`}</div>}
            </section>
          )}

          {pid && canReview && (
            <section>
              <h3>Export record set</h3>
              <div className="row small">
                <label><input type="radio" name="scope" checked={exportScope === 'set'} onChange={() => setExportScope('set')} data-testid="scope-set" /> Full set{drawing ? `: ${drawing.name}` : ''}</label>
                <label><input type="radio" name="scope" checked={exportScope === 'sheet'} onChange={() => setExportScope('sheet')} data-testid="scope-sheet" /> This sheet{sheet ? ` (${sheet.number})` : ''}</label>
              </div>
              <label className="small"><input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} /> include unconfirmed drafts</label>
              <div className="row">
                <button className="primary" disabled={!drawing || !!busy} onClick={exportPdf} data-testid="export">Export PDF</button>
                <button disabled={!drawing || !!busy} onClick={exportCsv} data-testid="export-csv">Markup log CSV</button>
                <button onClick={reset} className="ghost" data-testid="reset">Clear project</button>
              </div>
              <div className="muted tiny">PDF: editable Bluebeam/Acrobat cloud + callout annotations, plus a markup log page grouped by capture date.</div>
            </section>
          )}
          {busy && <div className="busy">{busy}</div>}
          {msg && <div className="okmsg" data-testid="msg">{msg}</div>}
          {err && <div className="err" data-testid="err">{err}</div>}
        </aside>
        <main>
          <SheetViewer drawingKey={sheet?.drawingId || null} loadDrawing={loadDrawing} sheet={sheet} markups={markups.filter((m) => !isForeman || m.createdBy === user.id || m.status === 'confirmed')} selectedId={selectedId} onSelect={setSelectedId} onChange={(id, b) => patch(id, b)} canEdit={canEdit} />
        </main>
      </div>
    </div>
  );
}
