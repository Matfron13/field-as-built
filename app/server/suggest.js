// Placement suggestion: vision LLM (xAI API) when XAI_API_KEY is set, else a deterministic text-match stub.

import { stubSuggest, boxesFromAnchor, parseOffsetFt, draftText } from '../shared/placement.js';
export { stubSuggest, boxesFromAnchor, parseOffsetFt, draftText };

// Gateway list price for spacexai/grok-4.20-non-reasoning (USD per token), from ai-gateway.vercel.sh/v1/models on 9 Nov 2026.
export const PRICE = { input: 1.25e-6, cached: 0.2e-6, output: 2.5e-6 };
export function estimateCost(u) {
  const cached = u.cached || 0;
  return Math.max(0, u.input - cached) * PRICE.input + cached * PRICE.cached + u.output * PRICE.output;
}

export async function llmSuggest({ sheet, note, photoBytes, photoMime, initials, provider }) {
  const { url, key, model } = provider;
  const items = sheet.items.slice(0, 300).map((it) => `${it.id}|${it.text}|${it.x},${it.y},${it.w},${it.h}`).join('\n');
  const sys = `You place as-built redline markups on electrical drawing sheets for a commercial electrical subcontractor.
Coordinates are PDF points, origin bottom-left, y increases upward (plan north is up). Sheet ${sheet.number} "${sheet.title}", ${sheet.width}x${sheet.height} pt, scale ${sheet.ptsPerFoot || 'unknown'} pt per foot.
Given a field photo, the foreman's note and the sheet's text items (id|text|x,y,w,h — x,y is the text baseline-left), pick the text item the change relates to (equipment tag, room number, device label) and any offset in feet the note implies.
Also rewrite the note as a concise as-built redline note in standard electrical trade wording, ALL CAPS, max 120 chars, no initials/date.
Reply ONLY with JSON: {"anchor_item_id": int|null, "offset_ft": {"x": number, "y": number}, "note": string, "confidence": number 0-1, "reasoning": string (one sentence)}`;
  const img = Buffer.from(photoBytes).toString('base64');
  const body = {
    model,
    temperature: 0,
    max_tokens: 400,
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
    const r = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const usage = j.usage ? { input: j.usage.prompt_tokens || 0, cached: j.usage.prompt_tokens_details?.cached_tokens || 0, output: j.usage.completion_tokens || 0 } : { input: 0, cached: 0, output: 0 };
    const gwCost = [j.usage?.cost, j.usage?.total_cost, j.provider_metadata?.gateway?.cost, j.providerMetadata?.gateway?.cost].map(Number).find((x) => Number.isFinite(x) && x > 0);
    usage.estCost = estimateCost(usage); usage.gatewayCost = gwCost ?? null; usage.model = model;
    const out = JSON.parse(j.choices[0].message.content.replace(/^```(json)?|```$/g, ''));
    const anchor = sheet.items.find((it) => it.id === out.anchor_item_id);
    if (!anchor) { const e = new Error('model returned no valid anchor_item_id'); e.usage = usage; throw e; }
    const offsetFt = { x: +out.offset_ft?.x || 0, y: +out.offset_ft?.y || 0 };
    const { cloud, callout } = boxesFromAnchor(sheet, anchor, offsetFt);
    return {
      method: `llm:${model}`,
      confidence: Math.max(0, Math.min(1, +out.confidence || 0.5)),
      usage,
      reasoning: `${out.reasoning || ''} (anchor "${anchor.text}", offset ${JSON.stringify(offsetFt)} ft)`,
      anchorText: anchor.text,
      cloud, callout,
      text: draftText(out.note || note, initials).replace(/^AS-BUILT: AS-BUILT:/, 'AS-BUILT:'),
    };
  } finally { clearTimeout(t); }
}

export async function suggest(args) {
  if (args.mode === 'llm' && args.provider) {
    try { return await llmSuggest(args); }
    catch (e) {
      const s = stubSuggest(args);
      s.reasoning = `AI placement failed (${e.message}); fell back to ${s.reasoning}`; s.method += ' (ai-fallback)';
      s.usage = e.usage || null; s.llmError = e.message; return s;
    }
  }
  const s = stubSuggest(args);
  if (args.stubReason) { s.method += ` (${args.stubReason})`; s.reasoning = `${args.stubNote || ''} ${s.reasoning}`.trim(); }
  return s;
}
