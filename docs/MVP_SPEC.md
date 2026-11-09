# Field Redline — MVP spec

_Status: approved to build (Matthew, 9 Nov 2026). Local prototype only; **no cloud infra created yet** (see §8, needs Civil SaaS Manager sign-off, and Matthew's for anything that costs money)._
Validation report: https://cursor.com/canvas/store-6658e47e-5890-4ddf-9b2c-759069c15ecb/37684d8b-dbd2-40b9-a686-7d636755c450

## 1. Product in one line
A foreman takes a photo plus a 10-second voice or text note when something is installed differently from the drawings. AI drafts a cloud and note on the right spot of the right sheet, a person confirms it, and the record set exports as a normal PDF that opens in Bluebeam with editable markups.

- **Wedge:** commercial electrical subcontractors ($5M–$100M revenue) whose PEs and PMs already use Bluebeam or Fieldwire.
- **Human-in-the-loop:** AI never publishes a redline by itself. Every markup starts as `draft`. Only `confirmed` markups are exported.
- **Selling line:** "Your record set is always ready for the pay-app review." The spec requirement (Div 01 78 39, 01 77 00) is the reason to adopt.

## 2. Users and roles
| Role | Device | Job |
|---|---|---|
| Foreman / journeyman | Phone (PWA) | Capture a change in under 30 seconds: photo(s), note, sheet. Optionally confirm the AI's pin right away. |
| Project engineer (PE) / PM | Laptop | Work the review queue: confirm, adjust, or reject drafts; edit wording; export the record set. |
| Admin (office) | Laptop | Create projects, upload and replace drawing sets, invite users. |

## 3. User flows

### 3.1 Foreman capture (phone)
1. Open project → **sheet pick** (last-used sheet first; list shows sheet number + title pulled from the PDF text layer; search by room or tag).
2. **Photo:** camera opens (`capture="environment"`); 1–3 photos. EXIF time and GPS are kept when the phone gives them.
3. **Note:** hold-to-talk voice note (on-device Web Speech for the MVP; server-side transcription later) or type it. Example: "LP-1 moved 3 ft north to clear duct."
4. **Submit:** the capture is saved locally first (offline queue in IndexedDB), then uploaded when there is signal.
5. **Suggest:** the server returns a draft cloud + callout on the sheet in about 3 seconds. The foreman sees it and can tap **Looks right** (stays `draft` but flagged "foreman-checked") or drag it. They don't have to wait for this; they can pocket the phone.

### 3.2 PE review queue (desktop)
1. Queue lists all `draft` markups across sheets. **Low confidence first**, then oldest. Each row shows the photo thumbnail, sheet, AI note, confidence, and who captured it.
2. Click a row → sheet opens zoomed to the cloud, photo shown side by side.
3. Actions: **drag** the cloud (callout follows), **drag** the callout alone, **resize** the cloud, **edit** the note text, **Confirm**, **Reject** (with reason), or **Back to draft**.
4. Every action is written to the markup's history (who, when, what). That gives the "record documents edit log" some owners' specs ask for.
5. Optional: link a markup to an RFI / CO / ASI number (free-text field in the MVP).

### 3.3 Export
1. **Export record set** → choose sheets (default: all sheets with confirmed markups) and whether to include drafts (default off; drafts are exported with a "DRAFT" subject if included).
2. Output: the original drawing PDF with **real PDF annotations** added (§6). No flattening by default, so markups stay editable in Bluebeam/Acrobat. A "flattened" option is for owners who want a static PDF.
3. Optional CSV/XLSX markup log (sheet, location, note, captured by, confirmed by, dates, RFI/CO link, photo URL).

## 4. Data model (Postgres / Supabase)
```
organizations(id, name, created_at)                       -- the sub's company; billing lives here
memberships(org_id, user_id, role: admin|pe|foreman)
projects(id, org_id, name, number, address, status, created_at)
drawing_sets(id, project_id, name, revision, storage_path, page_count, uploaded_by, uploaded_at, superseded_by)
sheets(id, drawing_set_id, project_id, page_index, sheet_number, title, discipline,
       width_pt, height_pt, rotation, scale_pts_per_ft, text_items jsonb,   -- PDF text layer (text, x, y, w, h)
       thumbnail_path)
captures(id, project_id, sheet_id, captured_by, captured_at, note_text, note_source: text|voice,
         audio_path, gps geography(point), heading, device_info jsonb, client_id uuid unique)   -- client_id = offline idempotency
capture_photos(id, capture_id, storage_path, mime, width, height, exif jsonb, ord)
markups(id, project_id, sheet_id, capture_id,
        status: draft|confirmed|rejected,
        cloud_rect jsonb {x,y,w,h},          -- PDF user-space points, origin bottom-left
        callout_rect jsonb {x,y,w,h},
        text, rfi_ref, co_ref,
        ai_method, ai_model, ai_confidence numeric, ai_reasoning, ai_anchor_text, ai_tokens_in, ai_tokens_out,
        created_at, confirmed_by, confirmed_at, rejected_by, rejected_reason)
markup_events(id, markup_id, actor_id, action: suggested|moved|edited|confirmed|rejected|reopened, before jsonb, after jsonb, at)
exports(id, project_id, requested_by, sheet_ids uuid[], include_drafts, storage_path, markup_count, created_at)
```
- Row-level security on every table by `org_id` via `memberships`. Foremen can insert captures and update only their own drafts; PEs and admins can confirm, reject, and export.
- Storage buckets (private): `drawings/`, `photos/`, `audio/`, `exports/`. Signed URLs only.
- Coordinates are always stored in **PDF user space** of the sheet, so export needs no conversion and markups survive any screen size.
- Revision carry-forward (week 6 or later): when a new `drawing_set` revision is uploaded, map markups by sheet number and re-anchor them by text match; anything that can't be re-anchored goes back to `draft`.

## 5. Placement approach (MVP)
**User picks the sheet. AI suggests the spot. User drags to fix.** Full auto-placement is out of scope.

1. **Sheet text layer** is extracted at upload with pdf.js: every text run with its position (room numbers, equipment tags like `LP-1`, device labels, grid bubbles) plus the sheet number, title, and drawing scale (e.g. `1/8" = 1'-0"` → 9 pt per foot).
2. **Vision LLM call** (one request per capture): photo + note + the sheet's text items (id, text, x, y, w, h) + sheet size and scale. The model returns strict JSON: `anchor_item_id`, `offset_ft {x,y}` (from phrases like "3 ft north"), a rewritten note in trade wording, `confidence`, and one sentence of reasoning.
3. **Deterministic geometry** on the server turns that into a cloud rectangle around the anchor (plus the offset at sheet scale) and a callout box beside it, kept inside the drawing area. The LLM never outputs raw coordinates. It only picks an anchor that exists on the sheet, which keeps hallucinated placements bounded.
4. **Fallback** when the LLM is down or returns an invalid anchor: a text-match stub (note tokens → best matching sheet text, weighted toward tags with letters + digits) with low confidence. The UI labels the method on every markup.
5. **Signals to add after the MVP:** last confirmed pin on that sheet, room tags read from the photo (already partly done by the VLM), GPS on georeferenced civil sheets, and per-company tag vocabularies.
6. **Success metric:** % of drafts confirmed without a move, and median drag distance. Target for pilots: ≥60% confirmed as-is, the rest fixed in one drag.

Prototype result on the sample sheet: grok-4.20 (non-reasoning) picked `PANEL LP-1`, applied the 3 ft north offset, and returned confidence 0.9 in about 2.5–3.4 s using about 2.5k input and 120 output tokens (≈ $0.004 per capture).

## 6. Markup export (Bluebeam-compatible PDF annotations)
Written with pdf-lib into the original PDF. One markup = two annotations:

| Piece | PDF annotation | Key entries |
|---|---|---|
| Cloud | `/Subtype /Polygon` | `/IT /PolygonCloud`, `/BE << /S /C /I 1 >>` (cloud border effect), `/Vertices` (rectangle), `/C [1 0 0]`, `/BS /W 1.5`, `/Subj (Cloud)`, `/T` author, `/Contents` note, `/NM` stable id, `/M` + `/CreationDate` |
| Callout | `/Subtype /FreeText` | `/IT /FreeTextCallout`, `/CL [x1 y1 x2 y2 x3 y3]` leader (cloud edge → knee → box), `/LE /OpenArrow`, `/RD` text-box inset, `/DA (/Helv 8 Tf 1 0 0 rg)`, `/DS`, `/Subj (Callout)`, `/IRT` → cloud + `/RT /Group` so the pair moves together |

- Both carry an explicit `/AP` appearance stream (scalloped bezier cloud; white box, red border, wrapped Helvetica text, leader and arrow). Viewers that don't build their own appearance (Chrome, Preview, pdf.js) still show them. Bluebeam and Acrobat open them as native, editable Cloud and Callout markups that appear in the Markups List with author, subject, and date.
- Custom keys (`/FAB_Status`, `/FAB_Capture`) allow round-trip import later; viewers ignore them.
- **To do before pilots:** open an export in Bluebeam Revu 21 and Acrobat to confirm the markups list shows them as Cloud / Callout and that editing regenerates appearance correctly. This hasn't been checked in Revu yet (no Revu on the box). Also add the photo as a hyperlink in `/Contents` or a `/FileAttachment` annotation.

## 7. Stack
| Layer | Choice | Why |
|---|---|---|
| Web app + API | **Next.js (App Router) on Vercel**, installable PWA for phones | One codebase for foreman and PE; route handlers for suggest/export; matches the other bots' stack |
| DB / Auth / Files | **Supabase** Postgres + Auth (email magic link, Google) + Storage | RLS for multi-tenant subs; Storage for PDFs, photos, and exports |
| PDF render | pdf.js (client) | Fast sheet render; same text layer used for placement |
| PDF write | pdf-lib (server route) | Writes real annotations; no native dependencies |
| Vision LLM | **Vercel AI Gateway** → `xai/grok-4.20-non-reasoning` (fallback model configured in Gateway), via AI SDK `generateObject` with a Zod schema | Provider failover, spend caps, no per-token markup; the prototype calls the xAI API directly with the same prompt |
| Voice | Web Speech API on device (MVP) → server transcription later | Zero cost for the MVP; works offline on iOS/Android Chrome/Safari for short notes |
| Offline | Service worker + IndexedDB capture queue | Basements and electrical rooms have no signal |
| Billing | Stripe Checkout + Customer Portal, per active project per month | Matches the pricing hypothesis in the validation report |
| Errors / analytics | Vercel logs + Sentry free tier (optional) | — |

## 8. Infra plan (to create later, only after Civil SaaS Manager + Matthew approve; nothing has been created)
All named `field-as-built`. Separate from other bots' projects so data, keys, and billing don't mix.

| # | Resource | Exact name / config | Expected cost |
|---|---|---|---|
| 1 | GitHub repo (private) | `field-as-built` (in Matthew's account or org; or Cursor Origin repo of the same name if that's the standard) | $0 |
| 2 | Supabase project | `field-as-built`, region `us-east-1`, Micro compute, in the existing org | If the org is already on Pro and its $10 compute credit is used by another project: **+$10/mo**. A new Pro org would be **$25/mo**. Free tier is OK for dev only (pauses after 1 week idle). Storage: 100 GB included on Pro, then $0.021/GB. |
| 3 | Supabase Storage buckets | `drawings`, `photos`, `audio`, `exports` (all private) | Included up to 100 GB |
| 4 | Vercel project | `field-as-built`, Next.js, linked to the repo; preview deploys on PRs; default URL `field-as-built.vercel.app` | $0 incremental on an existing Pro team (Pro is $20/user/mo if a team is needed; Hobby is non-commercial only) |
| 5 | Vercel env vars | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_GATEWAY_API_KEY` (or OIDC), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FAB_VISION_MODEL` | $0 |
| 6 | Vercel AI Gateway | Used from the `field-as-built` project; budget alert at $25/mo | Pass-through model pricing. grok-4.20: $1.25/M input, $2.50/M output → ≈ $0.004/capture on the sample sheet, ≈ $0.02–0.05 on dense real sheets (10–30k text tokens). 1,000 captures/mo ≈ $5–50. |
| 7 | Stripe products (test mode first) | `Field Redline – Project (monthly)` (hypothesis $300–600/active project/mo) and `Field Redline – Pilot (one-time)` (optional); prices in USD; metadata `app=field-as-built` | $0 fixed; 2.9% + 30¢ per card charge, plus Stripe Billing 0.7% of recurring volume |
| 8 | Stripe webhook endpoint (own) | `https://field-as-built.vercel.app/api/stripe/webhook`, events `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`; own signing secret | $0 |
| 9 | Domain (optional, later) | e.g. `fieldasbuilt.com` / `.app`, only at public launch | ~$15–25/yr |

**Expected run-rate during the build and pilots:** about **$10–35/mo** (Supabase compute ± plan) + **< $10/mo** LLM + $0 GitHub/Vercel on an existing team. Stripe costs only apply once revenue exists.

Guardrails: Stripe stays in **test mode** until Matthew approves a public launch. Live keys aren't used by this project before then. Spend caps go on Supabase (spend cap on) and AI Gateway (budget).

## 9. 6-week build plan
| Week | Goal | Done when |
|---|---|---|
| 1 | Foundation: repo, Supabase schema + RLS, auth, project + drawing-set upload, sheet extraction (number, title, scale, text layer) | A PE can sign in, create a project, upload a 50-sheet PDF and see a sheet list in < 60 s |
| 2 | Foreman capture PWA: sheet pick, camera, text + voice note, offline queue, upload | A capture made in airplane mode syncs later with no duplicates |
| 3 | Placement: AI Gateway + vision model with a strict schema, anchor geometry, stub fallback, confidence; eval set of ~50 real captures | ≥60% of eval drafts land within one cloud-width of where a PE would put them |
| 4 | PE review queue: viewer with drag, resize, and edit, confirm/reject, history log, low-confidence first | A PE clears 20 drafts in < 10 min |
| 5 | Export: annotation writer (cloud + callout + photo link), per-sheet / whole-set export, markup log CSV; **Bluebeam Revu and Acrobat compatibility test** | An export opens in Revu with the markups listed as Cloud/Callout and editable |
| 6 | Pilot readiness: Stripe test-mode checkout per project, onboarding, error tracking, demo project, 2–3 pilot electrical subs onboarded (from the interview list) | 2 pilot companies capturing on a live job |

Revision carry-forward, RFI/CO integrations (Procore, Fieldwire), and Bluebeam Studio push come after the pilots.

## 10. Risks to watch in the build
- **Placement trust:** one wrong redline is a liability. Keep confirm-before-export, show the method and confidence, and log every change.
- **Dense sheets:** real sheets can have thousands of text runs. Pre-filter by note tokens and the sheet region before sending them to the LLM, to control tokens and accuracy.
- **Scanned / raster sheets** have no text layer. They need OCR at upload (Tesseract or a vision model) and get a low-confidence fallback until that exists.
- **Rotated sheets / non-zero MediaBox origins:** the prototype assumes rotation 0 and an origin at 0,0. Production must normalize them.
- **OpenSpace** shipping "draft redline from photo" is the main competitive risk. Speed to pilots matters more than feature breadth.
