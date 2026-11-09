import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Scalloped cloud as an SVG path in screen space (y down).
function cloudD(x, y, w, h, b) {
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  let d = `M${x},${y}`;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / (b * 2))), seg = len / n;
    for (let j = 1; j <= n; j++) {
      const ex = ax + ((bx - ax) * j) / n, ey = ay + ((by - ay) * j) / n;
      d += ` A${seg / 2},${seg / 2} 0 0 1 ${ex},${ey}`;
    }
  }
  return d;
}

export default function SheetViewer({ drawingUrl, sheet, markups, selectedId, onSelect, onChange }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState(null); // {id, part, startX, startY, orig}
  const [local, setLocal] = useState({}); // id -> {cloud, callout} while dragging
  const docRef = useRef({ url: null, doc: null });

  const taskRef = useRef(null);
  const sheetKey = sheet ? `${sheet.id}:${sheet.page}:${sheet.width}` : null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!drawingUrl || !sheet) return;
      try { taskRef.current?.cancel(); await taskRef.current?.promise; } catch { /* cancelled */ }
      if (cancelled) return;
      if (docRef.current.url !== drawingUrl) docRef.current = { url: drawingUrl, doc: await pdfjs.getDocument(drawingUrl).promise };
      const page = await docRef.current.doc.getPage(sheet.page);
      const avail = (wrapRef.current?.clientWidth || 1000) - 4;
      const s = avail / sheet.width;
      const vp = page.getViewport({ scale: s * (window.devicePixelRatio || 1) });
      const c = canvasRef.current; if (!c || cancelled) return;
      c.width = vp.width; c.height = vp.height;
      c.style.width = `${sheet.width * s}px`; c.style.height = `${sheet.height * s}px`;
      taskRef.current = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
      await taskRef.current.promise;
      if (!cancelled) setScale(s);
    })().catch((e) => { if (e?.name !== 'RenderingCancelledException') console.error(e); });
    return () => { cancelled = true; };
  }, [drawingUrl, sheetKey]); // eslint-disable-line

  useEffect(() => { if (!drag) setLocal({}); }, [markups]); // eslint-disable-line
  if (!sheet) return <div className="empty">Load a drawing set to start.</div>;
  const H = sheet.height;
  // PDF box (origin bottom-left) -> screen rect
  const toScr = (b) => ({ x: b.x * scale, y: (H - b.y - b.h) * scale, w: b.w * scale, h: b.h * scale });

  const onDown = (e, m, part) => {
    e.stopPropagation(); e.preventDefault();
    onSelect(m.id);
    const cur = local[m.id] || { cloud: m.cloud, callout: m.callout };
    setDrag({ id: m.id, part, sx: e.clientX, sy: e.clientY, orig: cur });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / scale, dy = -(e.clientY - drag.sy) / scale;
    const o = drag.orig; let n;
    if (drag.part === 'cloud') n = { cloud: { ...o.cloud, x: o.cloud.x + dx, y: o.cloud.y + dy }, callout: { ...o.callout, x: o.callout.x + dx, y: o.callout.y + dy } };
    else if (drag.part === 'callout') n = { ...o, callout: { ...o.callout, x: o.callout.x + dx, y: o.callout.y + dy } };
    else if (drag.part === 'resize') n = { ...o, cloud: { ...o.cloud, w: Math.max(20, o.cloud.w + dx), h: Math.max(20, o.cloud.h - dy), y: o.cloud.y + Math.min(dy, o.cloud.h - 20) } };
    setLocal((l) => ({ ...l, [drag.id]: n }));
  };
  const onUp = () => {
    if (!drag) return;
    const n = local[drag.id];
    if (n) {
      const r = (b) => ({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.w.toFixed(1), h: +b.h.toFixed(1) });
      onChange(drag.id, { cloud: r(n.cloud), callout: r(n.callout) });
    }
    setDrag(null);
  };

  const visible = markups.filter((m) => m.sheetId === sheet.id);
  return (
    <div className="viewer" ref={wrapRef}>
      <div className="sheet" style={{ width: sheet.width * scale, height: sheet.height * scale }}>
        <canvas ref={canvasRef} data-testid="sheet-canvas" />
        <svg className="overlay" width={sheet.width * scale} height={sheet.height * scale} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerDown={() => onSelect(null)}>
          {visible.map((m) => {
            const cur = local[m.id] || m;
            const c = toScr(cur.cloud), t = toScr(cur.callout);
            const cls = `mk ${m.status} ${m.id === selectedId ? 'sel' : ''}`;
            const b = Math.max(5, Math.min(12, Math.min(cur.cloud.w, cur.cloud.h) / 6)) * scale;
            const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
            const tx = t.x + t.w / 2 > cx ? t.x : t.x + t.w, ty = t.y + t.h / 2;
            return (
              <g key={m.id} className={cls} data-testid={`markup-${m.id}`}>
                <line x1={cx} y1={cy} x2={tx} y2={ty} className="leader" />
                <path d={cloudD(c.x, c.y, c.w, c.h, b)} className="cloud" onPointerDown={(e) => onDown(e, m, 'cloud')} data-testid="cloud" />
                <rect x={c.x} y={c.y} width={c.w} height={c.h} className="hit" onPointerDown={(e) => onDown(e, m, 'cloud')} />
                <foreignObject x={t.x} y={t.y} width={t.w} height={Math.max(t.h, 20)} onPointerDown={(e) => onDown(e, m, 'callout')}>
                  <div className="callout" style={{ fontSize: Math.max(7, 8 * scale) }}>{m.text}</div>
                </foreignObject>
                {m.id === selectedId && <rect x={c.x + c.w - 5} y={c.y + c.h - 5} width={10} height={10} className="handle" onPointerDown={(e) => onDown(e, m, 'resize')} />}
                <text x={c.x} y={c.y - 4} className="badge">{m.status.toUpperCase()} · {Math.round(m.confidence * 100)}%</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
