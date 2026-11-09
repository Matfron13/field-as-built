import React, { useEffect, useMemo, useRef, useState } from 'react';
import SheetViewer from './SheetViewer.jsx';

const api = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); };
const pct = (x) => `${Math.round(x * 100)}%`;
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

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [st, setSt] = useState(null);
  const [sheetId, setSheetId] = useState(null);
  const [role, setRole] = useState('foreman');
  const [photo, setPhoto] = useState(null); // File
  const [note, setNote] = useState('');
  const [noteSource, setNoteSource] = useState('text');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [listening, setListening] = useState(false);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const recRef = useRef(null);

  const load = async () => { const s = await api('/api/state'); setSt(s); if (!sheetId || !s.sheets.find((x) => x.id === sheetId)) setSheetId(s.sheets[0]?.id || null); };
  useEffect(() => { api('/api/config').then(setCfg); load(); }, []); // eslint-disable-line

  const sheet = st?.sheets.find((s) => s.id === sheetId);
  const drawing = st?.drawings[0];
  const queue = useMemo(() => [...(st?.markups || [])].sort((a, b) => (a.status === 'draft' ? 0 : 1) - (b.status === 'draft' ? 0 : 1) || a.confidence - b.confidence), [st]);
  const selected = st?.markups.find((m) => m.id === selectedId);
  const counts = (st?.markups || []).reduce((a, m) => ({ ...a, [m.status]: (a[m.status] || 0) + 1 }), {});

  const run = async (label, fn) => { setBusy(label); setErr(''); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(''); } };

  const uploadPdf = (f) => run('Reading drawing set…', async () => { if (f.size > 4.4e6) throw new Error('This prototype accepts drawing PDFs up to 4.4 MB (serverless upload limit). Large sets will upload straight to storage in the MVP.'); const fd = new FormData(); fd.append('pdf', f); await api('/api/drawings', { method: 'POST', body: fd }); await load(); });
  const loadSample = () => run('Loading sample set…', async () => { await api('/api/sample/drawing', { method: 'POST' }); setSheetId(null); await load(); });
  const useSamplePhoto = async () => { const b = await (await fetch('/api/sample/photo')).blob(); setPhoto(new File([b], 'sample-field-photo-LP1.jpg', { type: 'image/jpeg' })); if (!note) { setNote('Panel LP-1 relocated 3 ft north to clear duct, conduits re-stubbed above'); setNoteSource('text'); } };

  const toggleMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr('Voice notes need a browser with Web Speech (Chrome/Safari). Type the note instead.'); return; }
    if (listening) { recRef.current?.stop(); return; }
    const r = new SR(); r.lang = 'en-US'; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => { setNote(Array.from(e.results).map((x) => x[0].transcript).join(' ')); setNoteSource('voice'); };
    r.onend = () => setListening(false); r.onerror = (e) => { setErr(`Mic: ${e.error}`); setListening(false); };
    recRef.current = r; r.start(); setListening(true);
  };

  const suggest = () => run(cfg?.placement === 'llm' ? `Asking ${cfg.model} for a placement…` : 'Suggesting placement (stub)…', async () => {
    const fd = new FormData(); fd.append('photo', await shrinkPhoto(photo)); fd.append('note', note); fd.append('sheetId', sheetId); fd.append('noteSource', noteSource); fd.append('by', 'Foreman');
    const { markup } = await api('/api/captures', { method: 'POST', body: fd });
    await load(); setSelectedId(markup.id); setPhoto(null); setNote('');
  });
  const patch = (id, body) => run('', async () => { await api(`/api/markups/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ by: role === 'pe' ? 'PE' : 'Foreman', ...body }) }); await load(); });
  const exportPdf = () => run('Exporting PDF…', async () => {
    const r = await fetch(`/api/export?statuses=${includeDrafts ? 'confirmed,draft' : 'confirmed'}`);
    if (!r.ok) throw new Error('export failed');
    const blob = await r.blob(); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `as-built-${new Date().toISOString().slice(0, 10)}.pdf`; a.click();
  });
  const reset = () => run('Resetting…', async () => { await api('/api/reset', { method: 'POST' }); setSelectedId(null); await load(); });

  return (
    <div className="app">
      <header>
        <div className="brand">Field As-Built <span className="proto">prototype</span></div>
        <div className="proj">{st?.project?.name}</div>
        <div className="roles">
          <button className={role === 'foreman' ? 'on' : ''} onClick={() => setRole('foreman')}>Foreman capture</button>
          <button className={role === 'pe' ? 'on' : ''} onClick={() => setRole('pe')}>PE review queue</button>
        </div>
        <div className={`mode ${cfg?.placement}`} data-testid="placement-mode">
          {cfg?.placement === 'llm' ? `AI placement: ${cfg.model}` : 'Placement: STUB (PDF text match, no AI)'}
        </div>
      </header>
      <div className="body">
        <aside>
          <section>
            <h3>1 · Drawing set</h3>
            {drawing ? <div className="muted small">{drawing.name}</div> : <div className="muted small">No drawings yet.</div>}
            <div className="row">
              <label className="btn">Upload PDF<input type="file" accept="application/pdf" hidden data-testid="pdf-input" onChange={(e) => e.target.files[0] && uploadPdf(e.target.files[0])} /></label>
              <button onClick={loadSample} data-testid="load-sample">Load sample set</button>
            </div>
            {st?.sheets.length > 0 && (
              <div className="sheets">
                {st.sheets.map((s) => (
                  <button key={s.id} className={s.id === sheetId ? 'on' : ''} onClick={() => setSheetId(s.id)} data-testid={`sheet-${s.number}`}>
                    <b>{s.number}</b> {s.title}
                  </button>
                ))}
              </div>
            )}
          </section>

          {role === 'foreman' && (
            <section>
              <h3>2 · Capture a field change</h3>
              <div className="muted small">Sheet: <b>{sheet ? `${sheet.number} ${sheet.title}` : '—'}</b></div>
              <div className="row">
                <label className="btn">{photo ? 'Change photo' : 'Take / pick photo'}<input type="file" accept="image/*" capture="environment" hidden data-testid="photo-input" onChange={(e) => e.target.files[0] && setPhoto(e.target.files[0])} /></label>
                <button onClick={useSamplePhoto} data-testid="sample-photo">Use sample photo</button>
              </div>
              {photo && <img className="thumb" src={URL.createObjectURL(photo)} alt="capture" />}
              <div className="row">
                <textarea rows={3} placeholder='Note, e.g. "LP-1 moved 3 ft north to clear duct"' value={note} onChange={(e) => { setNote(e.target.value); setNoteSource('text'); }} data-testid="note" />
              </div>
              <div className="row">
                <button onClick={toggleMic} className={listening ? 'rec' : ''}>{listening ? '■ Stop' : '🎤 Voice note'}</button>
                <button className="primary" disabled={!photo || !note.trim() || !sheet || !!busy} onClick={suggest} data-testid="suggest">Suggest placement</button>
              </div>
            </section>
          )}

          <section>
            <h3>{role === 'pe' ? '2' : '3'} · Review queue <span className="muted small">({counts.draft || 0} draft · {counts.confirmed || 0} confirmed · {counts.rejected || 0} rejected)</span></h3>
            {queue.length === 0 && <div className="muted small">No markups yet.</div>}
            {queue.map((m) => {
              const s = st.sheets.find((x) => x.id === m.sheetId);
              return (
                <div key={m.id} className={`qi ${m.status} ${m.id === selectedId ? 'sel' : ''}`} onClick={() => { setSelectedId(m.id); setSheetId(m.sheetId); }} data-testid={`queue-${m.id}`}>
                  <img src={`/api/captures/${m.captureId}/photo`} alt="" />
                  <div className="qt">
                    <div className="small"><b>{s?.number}</b> · <span className={`st ${m.status}`}>{m.status}</span> · conf {pct(m.confidence)} {m.confidence < 0.5 && <span className="low">LOW</span>}</div>
                    <div className="small">{m.text}</div>
                    <div className="muted tiny">{m.method}</div>
                  </div>
                </div>
              );
            })}
          </section>

          {selected && (
            <section className="detail">
              <h3>Selected markup</h3>
              <textarea rows={3} defaultValue={selected.text} key={selected.id + selected.text} onBlur={(e) => e.target.value !== selected.text && patch(selected.id, { text: e.target.value })} data-testid="markup-text" />
              <div className="muted tiny">Why here: {selected.reasoning}</div>
              <div className="muted tiny">Drag the cloud to move it (callout follows); drag the note box to move only the note; drag the corner handle to resize.</div>
              <div className="row">
                <button className="primary" onClick={() => patch(selected.id, { status: 'confirmed' })} data-testid="confirm">✓ Confirm</button>
                <button onClick={() => patch(selected.id, { status: 'rejected' })} data-testid="reject">✕ Reject</button>
                {selected.status !== 'draft' && <button onClick={() => patch(selected.id, { status: 'draft' })}>Back to draft</button>}
              </div>
            </section>
          )}

          <section>
            <h3>Export record set</h3>
            <label className="small"><input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} /> include unconfirmed drafts</label>
            <div className="row">
              <button className="primary" disabled={!drawing || !!busy} onClick={exportPdf} data-testid="export">Export PDF with markups</button>
              <button onClick={reset} className="ghost">Reset demo</button>
            </div>
            <div className="muted tiny">Writes PDF Cloud (Polygon /IT PolygonCloud) + Callout (FreeText) annotations that open as editable markups in Bluebeam/Acrobat.</div>
          </section>
          {busy && <div className="busy">{busy}</div>}
          {err && <div className="err">{err}</div>}
        </aside>
        <main>
          <SheetViewer drawingUrl={drawing ? `/api/drawings/${drawing.id}/file` : null} sheet={sheet} markups={st?.markups || []} selectedId={selectedId} onSelect={setSelectedId} onChange={(id, b) => patch(id, b)} />
        </main>
      </div>
    </div>
  );
}
