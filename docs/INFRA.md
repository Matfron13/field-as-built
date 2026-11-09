# Field As-Built — provisioned infra

_Last updated 9 Nov 2026, 9:45 AM EST. Running cost: $0/mo. Model spend is approved up to $10/mo, but $0.00 has been spent so far. Secrets are not in this file or the repo. They live in Vercel (sensitive env vars) and in `/workspace/field-as-built/app/data/secrets/` and `/workspace/field-as-built/.env.local` on the box (both gitignored)._

| Resource | ID / location | Notes |
|---|---|---|
| **Live app** | https://field-as-built.vercel.app | **Login required.** Supabase Auth email/password with invite-only accounts and no public signup. Every `/api` route except `public-config` and the signed Stripe webhook returns 401 without a session. Every response sends `noindex` (meta tag, `X-Robots-Tag` header, and `robots.txt` Disallow). The team alias and per-deployment URLs also sit behind Vercel login |
| Vercel project `field-as-built` | `prj_WexrryY5Qa2IUWY2LbXEO35NfywR`, team `gc-desk-ai` (`team_vwGVMFO5MbAhq0CqGTy98PjC`, Hobby) | Separate from GC Desk AI (`prj_EjWzKVglwNOPYxvmSHQlmma8R14I`, untouched). Deployed by file upload (no Git link). Latest prod deployment `dpl_8srSvvzN2JTimUvRtaNjQVDbdb7K` |
| Vercel env vars (field-as-built only) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `FAB_PLACEMENT=ai`, `STRIPE_WEBHOOK_SECRET` (sensitive). Leftover and unused: `FAB_DEMO_*` (the demo user is now banned) | AI goes through Vercel AI Gateway with the deployment's **OIDC token**. There's no AI Gateway API key and no `XAI_API_KEY` |
| AI placement | model `spacexai/grok-4.20-non-reasoning` via `https://ai-gateway.vercel.sh/v1` | **Blocked right now:** the Gateway returns 403 "Free tier users do not have access to this model" until paid Gateway credits exist (see Queued costs). The app falls back to text-match placement automatically, and the failed calls are logged at $0 |
| Spend guard | table `public.ai_usage`, function `public.ai_month_spend()` | Every model call logs tokens, the estimated cost (from token usage at Gateway list price: $1.25/M in, $0.20/M cached, $2.50/M out), the Gateway-reported cost, ok/error, and latency. Before each call the server sums month-to-date spend across all orgs. At **$9.50** or more, or if spend can't be read (fails closed), the capture falls back to stub placement with a note, and the header reads "AI paused". `max_tokens` is 400 per call |
| Gateway-level budget | — | **Not set.** The Vercel connector has no AI Gateway budget or alert tools. Set it by hand: Vercel dashboard → gc-desk-ai → AI Gateway → budget $10/mo |
| Supabase project `field-as-built` | ref `fvopgrpadcwzucyrzbuk`, org `fbnzgluxdjcfrklwgnxs` (Free), us-east-1 | Migrations in `supabase/migrations/`. RLS on all tables, with roles enforced in RLS: foreman = capture and edit own drafts; PE/admin = confirm/reject, add drawing sets, create projects, export. The API checks the same rules and returns 403 |
| Invite-only auth | `private.invites` plus triggers on `auth.users` | A DB trigger rejects any signup whose email isn't invited ("Field As-Built is invite-only"). Invited users get their membership and profile automatically. To invite someone: `insert into private.invites(email, org_id, role) values (...)`, then create the user (dashboard "Invite user" or SQL) |
| Accounts | org `0f1e0000-…a001` "Field As-Built Pilot" | `matfron13-v0nchn@mail.grokbot.com` (admin, Matthew), `e2e-pe@field-as-built.app` (pe), `e2e-foreman@field-as-built.app` (foreman). Passwords: `app/data/secrets/accounts.json` / `matthew_login.txt`. Old `demo@field-as-built.app` is banned and has no membership |
| Supabase Storage | private buckets `drawings`, `photos`, `audio`, `exports` | Paths `<org_id>/<project_id>/{drawings,photos}/...`. Member-only policies. The server reads them as the signed-in user, never with a service key |
| Stripe (TEST mode, `acct_1UPneEI4oNP3GdLA`) | `prod_Vb5O09sTUMKmC7` "Field As-Built – Project (monthly)", `price_1UZtDNI4oNP3GdLAsm20cFfs` ($450/mo placeholder); `prod_Vb5Onqs8dOG5AN` "Field As-Built – Pilot", `price_1UZtDPI4oNP3GdLAdL9PaAC5` ($1,000 one-time placeholder) | |
| Stripe webhook | `we_1UZtLgI4oNP3GdLA6pFUcbV9` → https://field-as-built.vercel.app/api/stripe/webhook | Signature-verified and outside the login gate (Stripe can't log in). Unsigned posts get 400 |
| Origin repo | https://cursor.com/codebase/matthew-fronczak/field-as-built (`r_01m70a649het3rexz4ffksc7rg`, private) | Still empty. The box has no Origin git credentials. Local commits are on `main` in `/workspace/field-as-built` |

## Queued costs (not bought; each needs Matthew's OK)
| Item | Est. cost | Why |
|---|---|---|
| Vercel AI Gateway paid credits (top-up) | Prepaid, e.g. $10. Spend stays under the $10/mo cap via the app guard | **Needed for AI placement to work at all.** The free tier blocks `grok-4.20-non-reasoning` (403). Once credits exist, nothing else changes: `FAB_PLACEMENT=ai` and OIDC are already live |
| Supabase Pro (org `fbnzgluxdjcfrklwgnxs`) | $25/mo | Unlocks leaked-password (HaveIBeenPwned) protection, which is Pro-only per Supabase docs and still flagged by the advisor. Also stops the 7-day idle pause, and gives session time-boxing |
| Vercel Pro | $20/user/mo | Not needed yet. Would allow larger function bodies and a team password-protection option |
| Custom domain | ~$10–15/yr | Not needed yet |

## Known limits
- Supabase Free pauses after 7 days idle. The org is at its 2-active-project Free limit.
- Vercel Functions take request bodies up to 4.5 MB. Photos are shrunk on the client, and drawing PDFs over 4.4 MB are rejected (large sets should later upload straight to Storage with signed URLs).
- Public signup can't be switched off from our tools; the DB trigger is what blocks it. To turn it off at the source too: Supabase dashboard → Auth → Providers → Email → disable "Allow new users to sign up" (free).
- The static JS/CSS bundle is publicly downloadable (it has no data in it). All data and files sit behind login.

Do not touch Supabase project `deofmqmqerqxbhatfznh` or Vercel project `prj_EjWzKVglwNOPYxvmSHQlmma8R14I` (GC Desk AI).
