# Field As-Built — local prototype

Auto-redline as-builts from field photos. AI drafts the cloud + note; a foreman or PE confirms; export a PDF with real Bluebeam-compatible annotations.
Live: https://field-as-built.vercel.app (stub placement, sample data). Infra and IDs: `docs/INFRA.md`. Spec: `docs/MVP_SPEC.md`.

## Run
```
cd app
npm install
npx vite build          # builds the UI into app/dist
PORT=4317 node server/index.js   # serves UI + API on http://localhost:4317
```
- Placement mode: if `XAI_API_KEY` is set, a vision LLM (`grok-4.20-0309-non-reasoning`, override with `FAB_VISION_MODEL`) suggests placement. Set `FAB_PLACEMENT=stub` to force the clearly-labeled text-match stub. The header shows which mode is on, and each markup records its method.
- Dev mode with hot reload: `node server/index.js` + `npx vite` (proxy `/api` → 4317).
- Storage: with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `FAB_DEMO_EMAIL`, `FAB_DEMO_PASSWORD`, `FAB_DEMO_ORG_ID` and `FAB_DEMO_PROJECT_ID` set, it uses Supabase (tables + private buckets) as the seeded demo user. Without them it falls back to `app/data/db.json` + `app/data/files/`.
- Vercel: `app/` is the project root (`vercel.json`: Vite static build + `api/index.js` Express function).

## Sample data (fake, clearly marked SAMPLE / NOT FOR CONSTRUCTION)
- `app/sample/sample-electrical-plan-E101-E201.pdf`: 2-sheet fake electrical set (E-101 power, E-201 lighting)
- `app/sample/sample-field-photo-LP1.jpg`: synthetic "field photo" of panel LP-1
- Regenerate: `python3 scripts/make_sample.py`

## Verify
```
cd app/scripts
python3 verify_e2e.py                         # drives the UI headlessly, exports, checks annotations
python3 check_annotations.py ../../out/exported-as-built.pdf
```
Screenshots land in `screenshots/`, the exported PDF in `out/`.
