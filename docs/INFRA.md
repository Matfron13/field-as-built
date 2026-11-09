# Field As-Built — provisioned infra

_Last updated 9 Nov 2026, 9:16 AM EST. Everything is $0/mo. Secrets are not in this file or the repo; they're in Vercel (sensitive env vars) and in `/workspace/field-as-built/.env.local` on the box (gitignored)._

| Resource | ID / location | Notes |
|---|---|---|
| **Live app** | https://field-as-built.vercel.app | Production alias is public (no login). Team alias `field-as-built-gc-desk-ai.vercel.app` and per-deployment URLs redirect to Vercel login (team members only) |
| Vercel project `field-as-built` | `prj_WexrryY5Qa2IUWY2LbXEO35NfywR`, team `gc-desk-ai` (`team_vwGVMFO5MbAhq0CqGTy98PjC`, Hobby) | Separate from GC Desk AI (`prj_EjWzKVglwNOPYxvmSHQlmma8R14I`, untouched). Deployed by file upload (no Git link yet). Vercel Authentication: `all_except_custom_domains` (project default) |
| Vercel env vars (field-as-built only; prod + preview) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `FAB_DEMO_EMAIL`, `FAB_DEMO_PASSWORD` (sensitive), `FAB_DEMO_ORG_ID`, `FAB_DEMO_PROJECT_ID`, `FAB_PLACEMENT=stub`, `STRIPE_WEBHOOK_SECRET` (sensitive) | **No** `XAI_API_KEY` / AI Gateway key; model spend on hold |
| Supabase project `field-as-built` | ref `fvopgrpadcwzucyrzbuk`, org `fbnzgluxdjcfrklwgnxs` (Free), us-east-1 | API https://fvopgrpadcwzucyrzbuk.supabase.co. Migrations in `supabase/migrations/`. RLS on all 10 tables; helpers in non-exposed `private` schema; advisors clean |
| Supabase Storage | private buckets `drawings`, `photos`, `audio`, `exports` | Object paths `<org_id>/<project_id>/...`; member-only policies |
| Demo tenant (seeded) | org `0f1e0000-0000-4000-8000-00000000a001` "Field As-Built Demo", project `…b001` "Sample Tenant Fit-Out (demo)", auth user `demo@field-as-built.app` (`…c001`, admin) | No end-user auth yet: the server signs in as this demo user, so RLS is enforced. The password is server-only. The service-role key isn't used (not available through the connector) |
| Stripe (TEST mode, `acct_1UPneEI4oNP3GdLA`) | `prod_Vb5O09sTUMKmC7` "Field As-Built – Project (monthly)", `price_1UZtDNI4oNP3GdLAsm20cFfs` ($450/mo placeholder) | |
| | `prod_Vb5Onqs8dOG5AN` "Field As-Built – Pilot", `price_1UZtDPI4oNP3GdLAdL9PaAC5` ($1,000 one-time placeholder) | |
| Stripe webhook | `we_1UZtLgI4oNP3GdLA6pFUcbV9` → https://field-as-built.vercel.app/api/stripe/webhook | Events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed. The handler verifies the signature and only acknowledges for now |
| Origin repo | https://cursor.com/codebase/matthew-fronczak/field-as-built (`r_01m70a649het3rexz4ffksc7rg`, private) | Created empty. Push pending: the box has no Origin git credentials (see report) |
| GitHub | — | Not used (GitHub not connected) |

## Known limits
- Supabase Free pauses after 7 days idle; the org is at its 2-active-project Free limit.
- Vercel Functions take request bodies up to 4.5 MB. The UI shrinks photos client-side and rejects drawing PDFs over 4.4 MB. The MVP should upload large sets straight to Storage with signed URLs.
- The public URL plus one shared demo user means anyone with the link can load or reset the demo data. That's fine for sample data only; real projects need auth first.

Do not touch Supabase project `deofmqmqerqxbhatfznh` or Vercel project `prj_EjWzKVglwNOPYxvmSHQlmma8R14I` (GC Desk AI).
