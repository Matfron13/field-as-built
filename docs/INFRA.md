# Field As-Built — provisioned infra (9 Nov 2026)

| Resource | ID / location | Status |
|---|---|---|
| Supabase project `field-as-built` | ref `fvopgrpadcwzucyrzbuk`, org `fbnzgluxdjcfrklwgnxs` (GC Desk AI, Free plan), us-east-1, $0/mo | Created. Schema from `supabase/migrations/` applied; RLS on all 10 tables; private buckets `drawings`, `photos`, `audio`, `exports`; security advisors clean |
| API URL | https://fvopgrpadcwzucyrzbuk.supabase.co | — |
| Stripe (TEST mode, acct_1UPneEI4oNP3GdLA) | `prod_Vb5O09sTUMKmC7` "Field As-Built – Project (monthly)", price `price_1UZtDNI4oNP3GdLAsm20cFfs` ($450/mo placeholder) | Created |
| | `prod_Vb5Onqs8dOG5AN` "Field As-Built – Pilot", price `price_1UZtDPI4oNP3GdLAdL9PaAC5` ($1,000 one-time placeholder) | Created |
| Stripe webhook | `<vercel-url>/api/stripe/webhook` | NOT created; no Vercel URL yet |
| Vercel project `field-as-built` | — | NOT created; the only Vercel scope is the `gc-desk-ai` team (Matthew's personal Hobby account is merged into it) |
| GitHub repo `field-as-built` | — | NOT created; GitHub isn't connected (no gh login, cursor-github needs auth) |

Do not touch Supabase project `deofmqmqerqxbhatfznh` (GC Desk AI).
Free tier note: Supabase pauses Free projects after 1 week of inactivity, and the org can have at most 2 active Free projects (it now has 2).
