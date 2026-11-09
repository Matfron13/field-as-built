# Field Redline — local prototype

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


## Live site (as of 9 Nov 2026)
Public: https://field-as-built.vercel.app (landing page + pilot request form) and https://field-as-built.vercel.app/demo (read-only demo on the SAMPLE set, simulated capture in the browser). Rebuild demo files with `node app/scripts/build_demo.mjs`.

Private app: https://field-as-built.vercel.app/app requires a login. Accounts are invite-only (see docs/INFRA.md). Matthew's login is in `app/data/secrets/matthew_login.txt` on the box (not in git).

What it does: you sign in, then pick a project (PE/admin can create one with "+ Project") and a sheet (the phone picker has search and recent sheets). A foreman saves a photo and note as a capture: it goes to the on-phone IndexedDB outbox first and syncs right away, or later if there's no signal, and gets a draft markup (AI placement via AI Gateway when credits exist, otherwise text match). A PE drags and confirms or rejects the drafts, then exports a PDF (full set or one sheet) with editable Bluebeam clouds and callouts plus a markup-log page grouped by capture date, or a markup log CSV.

E2E test: `python3 app/scripts/verify_e2e.py https://field-as-built.vercel.app` (47 checks: public site, lead form + rate limit, data privacy, then the full signed-in flow; at most 1 model call per run). Local: `cd app && npm run build && node server/index.js` with `.env.local` loaded. It uses the same Supabase project with `FAB_PLACEMENT=stub`.
