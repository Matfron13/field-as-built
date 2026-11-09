// Local server: API + built UI on one port.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, placementMode } from './app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 4317;
const app = createApp();
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get(/^\/(?!api).*/, (_q, r) => r.sendFile(path.join(dist, 'index.html'))); }
app.listen(PORT, '0.0.0.0', () => console.log(`Field As-Built prototype on http://localhost:${PORT} (placement: ${placementMode()}, store: ${process.env.SUPABASE_URL ? 'supabase' : 'json'})`));
