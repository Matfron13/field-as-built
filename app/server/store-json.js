// Local-only store: JSON file + files on disk (used when SUPABASE_URL is not set).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function jsonStore(dataDir) {
  const FILES = path.join(dataDir, 'files'); fs.mkdirSync(FILES, { recursive: true });
  const DBF = path.join(dataDir, 'db.json');
  const empty = () => ({ project: { id: 'p1', name: 'Sample Tenant Fit-Out (demo)' }, drawings: [], sheets: [], captures: [], markups: [] });
  let db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : empty();
  if (!db.project) db = empty();
  const save = () => fs.writeFileSync(DBF, JSON.stringify(db, null, 1));
  const id = () => crypto.randomUUID();
  const pub = ({ items, ...s }) => ({ ...s, textItemCount: items.length });
  return {
    kind: 'json',
    async getState() { return { project: db.project, drawings: db.drawings.map(({ file, ...d }) => d), sheets: db.sheets.map(pub), captures: db.captures.map(({ photoFile, ...c }) => c), markups: db.markups }; },
    async replaceDrawing(name, bytes, sheets) {
      const did = id(); const file = path.join(FILES, `${did}.pdf`); fs.writeFileSync(file, bytes);
      db.drawings = [{ id: did, name, file, pages: sheets.length, uploadedAt: new Date().toISOString() }];
      db.sheets = sheets.map((s) => ({ id: `${did}-${s.page}`, drawingId: did, ...s }));
      db.captures = []; db.markups = []; save();
    },
    async getDrawing(did) { const d = db.drawings.find((x) => !did || x.id === did); return d && fs.readFileSync(d.file); },
    async getSheet(sid) { return db.sheets.find((s) => s.id === sid); },
    async addCapture({ sheetId, note, noteSource, photoBytes, photoMime, ext }) {
      const cid = id(); const photoFile = path.join(FILES, `${cid}${ext}`); fs.writeFileSync(photoFile, photoBytes);
      const c = { id: cid, sheetId, note, noteSource, photoFile, photoMime, createdAt: new Date().toISOString() };
      db.captures.push(c); save(); const { photoFile: _, ...out } = c; return out;
    },
    async getPhoto(cid) { const c = db.captures.find((x) => x.id === cid); return c && { bytes: fs.readFileSync(c.photoFile), mime: c.photoMime }; },
    async addMarkup(m) { const mk = { id: id(), ...m, history: [{ at: new Date().toISOString(), action: 'suggested', by: m.method }] }; db.markups.push(mk); save(); return mk; },
    async updateMarkup(mid, fields, actions, by) {
      const m = db.markups.find((x) => x.id === mid); if (!m) return null;
      Object.assign(m, fields); m.history.push({ at: new Date().toISOString(), action: actions.join(','), by }); save(); return m;
    },
    async listMarkups(statuses) { return db.markups.filter((m) => statuses.includes(m.status)); },
    async reset() { db = empty(); save(); },
  };
}
