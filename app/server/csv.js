// Markup log CSV (one row per markup, sorted by capture time).
import { dayKey } from './exportPdf.js';
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function markupCsv(markups, { people = {}, tz = 'America/New_York', base = '' } = {}) {
  const p = (id) => (id && people[id] ? people[id].email : '');
  const head = ['capture_date', 'captured_at', 'sheet', 'sheet_title', 'status', 'markup_text', 'field_note', 'captured_by', 'confirmed_by', 'confirmed_at', 'placement_method', 'ai_confidence', 'cloud_x_pt', 'cloud_y_pt', 'cloud_w_pt', 'cloud_h_pt', 'photo_url', 'markup_id', 'capture_id'];
  const rows = markups.map((m) => [dayKey(m.capturedAt || m.createdAt, tz), m.capturedAt || m.createdAt, m.sheetNumber, m.sheetTitle, m.status, m.text, m.note, p(m.capturedBy), p(m.confirmedBy), m.confirmedAt, m.method, m.confidence, m.cloud?.x, m.cloud?.y, m.cloud?.w, m.cloud?.h, m.captureId ? `${base}/api/captures/${m.captureId}/photo` : '', m.id, m.captureId]);
  return '\ufeff' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
