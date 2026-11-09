import React, { useMemo, useState } from 'react';
// Phone-friendly sheet picker: one big button that opens a full-screen list with search,
// recently used sheets first, then sheets grouped by drawing set. Large tap targets.
export default function SheetPicker({ sheets, drawings, sheetId, recent = [], onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const cur = sheets.find((s) => s.id === sheetId);
  const live = new Set(drawings.filter((d) => !d.supersededBy).map((d) => d.id));
  const match = (s) => !q || `${s.number} ${s.title}`.toLowerCase().includes(q.toLowerCase());
  const recentSheets = useMemo(() => recent.map((id) => sheets.find((s) => s.id === id)).filter(Boolean).slice(0, 4), [recent, sheets]);
  const pick = (s) => { onPick(s.id); setOpen(false); setQ(''); };
  const Item = ({ s, tid = 'sheet' }) => (
    <button className={`pick ${s.id === sheetId ? 'on' : ''}`} onClick={() => pick(s)} data-testid={`${tid}-${s.number}`}>
      <b>{s.number || `p${s.page}`}</b><span>{s.title}</span>
    </button>
  );
  return (
    <>
      <button className="sheetbtn" onClick={() => setOpen(true)} disabled={!sheets.length} data-testid="sheet-picker">
        {cur ? <><b>{cur.number}</b> {cur.title}</> : sheets.length ? 'Pick a sheet…' : 'No sheets yet'} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="picker" role="dialog">
          <div className="pickhead">
            <input autoFocus placeholder="Search sheet # or title (e.g. E-101, lighting)" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sheet-search" />
            <button onClick={() => setOpen(false)}>Close</button>
          </div>
          <div className="picklist">
            {!q && recentSheets.length > 0 && <><div className="pickgroup">Recent</div>{recentSheets.map((s) => <Item key={'r' + s.id} s={s} tid="recent" />)}</>}
            {drawings.filter((d) => live.has(d.id)).map((d) => {
              const ss = sheets.filter((s) => s.drawingId === d.id && match(s));
              return ss.length ? <React.Fragment key={d.id}><div className="pickgroup">{d.name}</div>{ss.map((s) => <Item key={s.id} s={s} />)}</React.Fragment> : null;
            })}
          </div>
        </div>
      )}
    </>
  );
}
