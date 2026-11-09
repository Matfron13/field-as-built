// Placement suggestion: vision LLM (xAI API) when XAI_API_KEY is set, else a deterministic text-match stub.
import fs from 'node:fs';

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

export async function llmSuggest({ sheet, note, photoPath, photoMime, initials }) {
  const key = process.env.XAI_API_KEY;
  const model = process.env.FAB_VISION_MODEL || 'grok-4.20-0309-non-reasoning';
  const items = sheet.items.slice(0, 400).map((it) => `${it.id}|${it.text}|${it.x},${it.y},${it.w},${it.h}`).join('\n');
  const sys = `You place as-built redline markups on electrical drawing sheets for a commercial electrical subcontractor.
Coordinates are PDF points, origin bottom-left, y increases upward (plan north is up). Sheet ${sheet.number} "${sheet.title}", ${sheet.width}x${sheet.height} pt, scale ${sheet.ptsPerFoot || 'unknown'} pt per foot.
Given a field photo, the foreman's note and the sheet's text items (id|text|x,y,w,h — x,y is the text baseline-left), pick the text item the change relates to (equipment tag, room number, device label) and any offset in feet the note implies.
Also rewrite the note as a concise as-built redline note in standard electrical trade wording, ALL CAPS, max 120 chars, no initials/date.
Reply ONLY with JSON: {"anchor_item_id": int|null, "offset_ft": {"x": number, "y": number}, "note": string, "confidence": number 0-1, "reasoning": string (one sentence)}`;
  const img = fs.readFileSync(photoPath).toString('base64');
  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${photoMime};base64,${img}`, detail: 'high' } },
        { type: 'text', text: `Foreman note: "${note}"\n\nSheet text items:\n${items}` },
      ] },
    ],
  };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const out = JSON.parse(j.choices[0].message.content.replace(/^```(json)?|```$/g, ''));
    const anchor = sheet.items.find((it) => it.id === out.anchor_item_id);
    if (!anchor) throw new Error('model returned no valid anchor_item_id');
    const offsetFt = { x: +out.offset_ft?.x || 0, y: +out.offset_ft?.y || 0 };
    const { cloud, callout } = boxesFromAnchor(sheet, anchor, offsetFt);
    return {
      method: `llm:${model}`,
      confidence: Math.max(0, Math.min(1, +out.confidence || 0.5)),
      usage: j.usage ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } : null,
      reasoning: `${out.reasoning || ''} (anchor "${anchor.text}", offset ${JSON.stringify(offsetFt)} ft)`,
      anchorText: anchor.text,
      cloud, callout,
      text: draftText(out.note || note, initials).replace(/^AS-BUILT: AS-BUILT:/, 'AS-BUILT:'),
    };
  } finally { clearTimeout(t); }
}

export async function suggest(args) {
  const mode = args.mode || (process.env.XAI_API_KEY && process.env.FAB_PLACEMENT !== 'stub' ? 'llm' : 'stub');
  if (mode === 'llm') {
    try { return await llmSuggest(args); }
    catch (e) { const s = stubSuggest(args); s.reasoning = `LLM failed (${e.message}); fell back to ${s.reasoning}`; s.method += ' (llm-fallback)'; return s; }
  }
  return stubSuggest(args);
}
