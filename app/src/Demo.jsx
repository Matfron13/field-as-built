import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SheetViewer from './SheetViewer.jsx';
import SheetPicker from './SheetPicker.jsx';
import Brand from './Brand.jsx';
import { stubSuggest } from '../shared/placement.js';

// Public, read-only demo on the SAMPLE set. Everything is static files under /demo/;
// "Try a capture" runs text-match placement in this browser only: no API, database, storage or AI calls.
const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export default function Demo() {
  const [d, setD] = useState(null);
  const [sheetId, setSheetId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [local, setLocal] = useState([]); // simulated captures (this browser only)
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState(null);
  const [view, setView] = useState('sheet');
  useEffect(() => { fetch('/demo/demo.json').then((r) => r.json()).then((j) => { setD(j); setSheetId(j.sheets[0].id); }); }, []);
  const loadDrawing = useCallback(async () => new Uint8Array(await (await fetch('/demo/sample-set.pdf')).arrayBuffer()), []);
  const sheet = d?.sheets.find((s) => s.id === sheetId);
  const markups = useMemo(() => [...(d?.markups || []), ...local], [d, local]);
  const groups = useMemo(() => {
    const g = new Map();
    for (const m of [...markups].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) { const k = fmtDay(m.capturedAt); if (!g.has(k)) g.set(k, []); g.get(k).push(m); }
    return [...g.entries()];
  }, [markups]);
  const who = (id) => d?.people[id]?.initials || (id === 'you' ? 'YOU' : '');
  const selected = markups.find((m) => m.id === selectedId);

  const simulate = () => {
    const s = stubSuggest({ sheet, note, initials: 'YOU' });
    const now = new Date().toISOString();
    const m = { id: `local-${Date.now()}`, sheetId: sheet.id, sheetNumber: sheet.number, page: sheet.page, status: 'draft', simulated: true, cloud: s.cloud, callout: s.callout, text: s.text, note, confidence: s.confidence, method: 'demo: text match in your browser', reasoning: s.reasoning, anchorText: s.anchorText, capturedBy: 'you', capturedAt: now, createdAt: now };
    setLocal((l) => [...l, m]); setSelectedId(m.id); setNote(''); setView('sheet');
  };
  const move = (id, b) => setLocal((l) => l.map((m) => (m.id === id ? { ...m, ...b } : m)));

  if (!d) return <div className="empty">Loading demo…</div>;
  return (
    <div className="app demo">
      <header>
        <Brand href="/" />
        <span className="rolechip">LIVE DEMO · sample data</span>
        <span className="small">{d.project.name}</span>
        <a className="hdrbtn right btn" href="/#pilot" data-testid="demo-pilot">Request a pilot</a>
        <a className="hdrbtn btn" href="/app">Sign in</a>
      </header>
      <nav className="tabs show"><button className={view === 'sheet' ? 'on' : ''} onClick={() => setView('sheet')} data-testid="tab-sheet">Sheet</button><button className={view === 'log' ? 'on' : ''} onClick={() => setView('log')} data-testid="tab-log">Markup log</button></nav>
      <div className={`body view-${view}`}>
        <aside>
          <section>
            <h3>Sheet</h3>
            <SheetPicker sheets={d.sheets} drawings={d.drawings} sheetId={sheetId} onPick={(id) => { setSheetId(id); setView('sheet'); }} />
            <div className="muted tiny">Sample electrical set: E-101 power, E-201 lighting. Fictional project.</div>
          </section>
          <section>
            <h3>Redlines <span className="muted small">({markups.filter((m) => m.status === 'confirmed').length} confirmed · {markups.filter((m) => m.status === 'draft').length} draft)</span></h3>
            {groups.map(([day, ms]) => (
              <div key={day}><div className="daygroup">{day}</div>
                {ms.map((m) => (
                  <div key={m.id} className={`qi ${m.status} ${m.id === selectedId ? 'sel' : ''}`} onClick={() => { setSelectedId(m.id); setSheetId(m.sheetId); setView('sheet'); }} data-testid={`demo-mk-${m.id}`}>
                    <img src="/demo/sample-photo.jpg" alt="" />
                    <div className="qt">
                      <div className="small"><b>{m.sheetNumber}</b> · <span className={`st ${m.status}`}>{m.simulated ? 'your draft' : m.status}</span></div>
                      <div className="small">{m.text}</div>
                      <div className="muted tiny">{who(m.capturedBy)} · {fmtTime(m.capturedAt)}{m.confirmedBy ? ` · confirmed by ${who(m.confirmedBy)}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </section>
          {selected && <section className="detail"><h3>Selected</h3><div className="small">{selected.text}</div><div className="muted tiny">Field note: {selected.note}</div>{selected.simulated && <div className="muted tiny">Simulated in your browser. Drag it on the sheet. Nothing is saved.</div>}</section>}
          <section>
            <h3>Try a capture</h3>
            <div className="muted tiny">Type a field note for <b>{sheet?.number}</b>. In this demo the redline is placed by text matching right in your browser. Nothing is uploaded or saved, and there's no AI call. Try: "Panel LP-1 moved 5 ft east" or "Floor box FB-1 relocated 3 ft south".</div>
            <div className="row"><label className="btn">📷 Photo (stays on your device)<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files[0] && setPhotoUrl(URL.createObjectURL(e.target.files[0]))} /></label></div>
            {photoUrl && <img className="thumb" src={photoUrl} alt="" />}
            <div className="row"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed in the field?" data-testid="demo-note" /></div>
            <div className="row"><button className="primary grow" disabled={!note.trim() || !sheet} onClick={simulate} data-testid="demo-simulate">Place redline (simulated)</button></div>
          </section>
          <section>
            <h3>Export</h3>
            <div className="row">
              <a className="btn primary" href="/demo/sample-as-built-export.pdf" download data-testid="demo-export-pdf">Download sample PDF export</a>
              <a className="btn" href="/demo/sample-markup-log.csv" download data-testid="demo-export-csv">Markup log CSV</a>
            </div>
            <div className="muted tiny">The PDF opens in Bluebeam or Acrobat with editable cloud and callout annotations, plus a markup log page grouped by capture date (confirmed markups only).</div>
          </section>
          <section className="demo-cta"><b>Want this on your project?</b><div className="row"><a className="btn primary" href="/#pilot">Request a pilot</a></div></section>
        </aside>
        <main>
          {view === 'log' ? (
            <div className="logview" data-testid="markup-log">
              <h2>Markup log</h2>
              {groups.map(([day, ms]) => (
                <table key={day}><caption>{day} ({ms.length})</caption>
                  <thead><tr><th>Time</th><th>Sheet</th><th>Status</th><th>By / confirmed</th><th>Markup</th></tr></thead>
                  <tbody>{ms.map((m) => <tr key={m.id}><td>{fmtTime(m.capturedAt)}</td><td>{m.sheetNumber}</td><td className={`st ${m.status}`}>{m.simulated ? 'your draft' : m.status.toUpperCase()}</td><td>{who(m.capturedBy)}{m.confirmedBy ? ` / ${who(m.confirmedBy)}` : ''}</td><td>{m.text}</td></tr>)}</tbody>
                </table>
              ))}
            </div>
          ) : (
            <SheetViewer drawingKey="demo-set" loadDrawing={loadDrawing} sheet={sheet} markups={markups} selectedId={selectedId} onSelect={setSelectedId} onChange={move} canEdit={(m) => !!m.simulated} />
          )}
        </main>
      </div>
    </div>
  );
}
