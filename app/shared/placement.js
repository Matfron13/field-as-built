// Deterministic text-match placement (no AI). Shared by the server and the public demo (runs in the browser there).
const STOP = new Set(['THE', 'AND', 'WAS', 'WERE', 'FROM', 'WITH', 'MOVED', 'MOVE', 'RELOCATED', 'TO', 'OF', 'IN', 'ON', 'AT', 'FOR', 'NEW', 'PER', 'FIELD', 'INSTEAD', 'NOT', 'ADDED', 'ADD', 'REMOVED', 'FEET', 'FOOT', 'FT', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'ROOM', 'THIS', 'THAT', 'ABOUT', 'APPROX']);
const DIRS = { NORTH: [0, 1], UP: [0, 1], SOUTH: [0, -1], DOWN: [0, -1], EAST: [1, 0], RIGHT: [1, 0], WEST: [-1, 0], LEFT: [-1, 0] };

export function parseOffsetFt(note) {
  const m = note.toUpperCase().match(/(\d+(?:\.\d+)?)\s*(?:FT|FEET|FOOT|')\s*(?:TO THE\s+)?(NORTH|SOUTH|EAST|WEST|UP|DOWN|LEFT|RIGHT)/);
  if (!m) return { x: 0, y: 0 };
  const [dx, dy] = DIRS[m[2]];
  return { x: dx * +m[1], y: dy * +m[1] };
}

export function draftText(note, initials) {
  const d = new Date();
  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  const body = note.trim().replace(/\s+/g, ' ').toUpperCase();
  return `AS-BUILT: ${body} (${initials} ${date})`;
}

function tokens(note) {
  return [...new Set(note.toUpperCase().match(/[A-Z0-9][A-Z0-9\-\/]*[A-Z0-9]|[0-9]+/g) || [])].filter((t) => !STOP.has(t) && (t.length >= 3 || /\d/.test(t)));
}

export function boxesFromAnchor(sheet, anchor, offsetFt) {
  const ppf = sheet.ptsPerFoot || 9;
  const cx = anchor.x + anchor.w / 2 + offsetFt.x * ppf;
  const cy = anchor.y + anchor.h / 2 + offsetFt.y * ppf;
  const w = Math.max(anchor.w + 50, 80), h = Math.max(anchor.h + 40, 50);
  const cloud = clampBox({ x: cx - w / 2, y: cy - h / 2, w, h }, sheet);
  const cw = 190, ch = 56;
  let callout = { x: cloud.x + cloud.w + 40, y: cloud.y + cloud.h + 30, w: cw, h: ch };
  if (callout.x + cw > sheet.width - 30) callout.x = cloud.x - cw - 40;
  if (callout.y + ch > sheet.height - 30) callout.y = cloud.y - ch - 30;
  return { cloud, callout: clampBox(callout, sheet) };
}

function clampBox(b, sheet) {
  const x = Math.min(Math.max(b.x, 25), sheet.width - b.w - 25);
  const y = Math.min(Math.max(b.y, 25), sheet.height - b.h - 25);
  return { x: +x.toFixed(1), y: +y.toFixed(1), w: +b.w.toFixed(1), h: +b.h.toFixed(1) };
}

export function stubSuggest({ sheet, note, initials }) {
  const toks = tokens(note);
  let best = null, bestScore = 0;
  for (const it of sheet.items) {
    const T = it.text.toUpperCase();
    let s = 0;
    for (const t of toks) {
      const re = new RegExp(`(^|[^A-Z0-9])${t.replace(/[-\/]/g, '\\$&')}($|[^A-Z0-9])`);
      if (re.test(T)) s += t.length * (/\d/.test(t) && /[A-Z]/.test(t) ? 3 : /\d/.test(t) ? 1.5 : 1);
    }
    s -= T.length * 0.01; // prefer tight labels over long notes
    if (s > bestScore) { bestScore = s; best = it; }
  }
  const offsetFt = parseOffsetFt(note);
  const anchor = best || { x: sheet.width / 2 - 20, y: sheet.height / 2, w: 40, h: 10, text: '(no match)' };
  const { cloud, callout } = boxesFromAnchor(sheet, anchor, offsetFt);
  return {
    method: 'stub-text-match',
    confidence: best ? Math.min(0.85, 0.3 + bestScore / 30) : 0.05,
    reasoning: best
      ? `STUB: matched note tokens [${toks.join(', ')}] to sheet text "${anchor.text}"` + (offsetFt.x || offsetFt.y ? `; applied ${JSON.stringify(offsetFt)} ft offset at ${sheet.ptsPerFoot || 9} pt/ft` : '')
      : 'STUB: no sheet text matched the note; placed at sheet center for manual drag',
    anchorText: anchor.text,
    cloud, callout,
    text: draftText(note, initials),
  };
}

