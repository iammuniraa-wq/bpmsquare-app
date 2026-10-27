# Dedicated instance: the KAMCO set-up, step by step (a record to repeat next time)

> Recorded 2026-10-26 while standing up the first dedicated instance (KAMCO, Europe). The long reference is
> `docs/dedicated-instance.md` (sections quoted below); this file is the **order that worked**, the **exact settings used**
> and the **mistakes avoided**. No secret appears in it. Per instance: copy the "Values used" table and change the right column.

## Values used for KAMCO (change these per client)

| Item | KAMCO value |
|---|---|
| Slug / tenant name | `kamco` / KAMCO |
| Public address | `kamco.bpmsquare.com` (the client's own domain is better when they have one) |
| Currency, timezone | SAR, Asia/Riyadh (timezone is set in the tenant's settings; the studio has no field for it) |
| Supabase project | `bpmsquare-kamco`, ref `qddkfvhhmyujnpgisgwr`, Central EU (Frankfurt) `eu-central-1`, Micro compute (raise to Small before real use), Pro org |
| Vercel project | `bpmsquare-kamco` in the same Pro team, production branch `instance/kamco` |
| Git branch | `instance/kamco` = `main` + `vercel.json` region `fra1` + migrations folder fit for an empty database |
| AI | On from day one (owner's choice); **needs the client's written OK** because prompts leave Europe |
| Operator login | the owner's address (a `platform_admins` row from the baseline), tenant admin alias `sap.rashid+kamco@gmail.com` |

## The order that worked

### 1. Decide (owner, before anything)
Region, AI on/off, who creates the accounts, domain, slug, currency, e-mail sending domain. (`dedicated-instance.md` section 0, D1 to D7.)

### 2. Prepare the code (done once, by the builder)
1. `node scripts/dedicated/build-fresh-schema.mjs` must say `0 error(s), 0 warning(s)` (175 files on 2026-10-26).
2. Create the branch `instance/<slug>` from `main`. Change **only** `vercel.json` `"regions"` to the Vercel region next to the database (`fra1` for Frankfurt).
3. On that branch make the migrations folder safe for an **empty** database, because Supabase's GitHub link applies the folder as it is:
   comment out the baseline's `insert into tenants ... 'vikas'` block, delete `0031_copy_vikas_pioneers_entity_profile.sql`,
   and append the `case-photos` bucket insert to `0000_baseline.sql` (no migration creates it).
4. Add `docs/instances/<slug>.md` (the ledger: choices, commit built from, highest migration applied). No secrets.
5. Push the branch.

### 3. Supabase project (owner clicks, with the dashboard open)
1. New project in the **Pro** org. Name `bpmsquare-<slug>`. Region: pick the **specific** region in the list (Central EU (Frankfurt)), not the group "Europe".
2. GitHub field: choose the repo (`iammuniraa-wq/bpmsquare-app`).
3. Database password: "Generate a password", straight into the password manager. Never in chat.
4. Security: keep **Enable Data API** ticked and keep **Automatically expose new tables** ticked (the app reads tables through the Data API; turning it off breaks every page). Leave **Enable automatic RLS** off (the migrations set their own policies).
5. Create. Note the project ref and the three keys (URL, anon, service-role) in the password manager.
6. Settings > Integrations > GitHub: working directory `.`, **Deploy to production ON**, production branch `instance/<slug>`, automatic branching **OFF** (preview branches are billed outside the spend cap). Save.
7. Push one commit to `instance/<slug>`. Supabase applies **every** migration in order (not retroactively, only on a push). Check Database > Migrations: the list runs `0000 baseline` to the newest.
8. Check (SQL editor, read only): `tenants` = 0, `platform_admins` = 1, 9 storage buckets, about 206 public tables, about 231 policies. **No sample data is loaded.**
9. Authentication > URL Configuration: Site URL `https://<domain>`; redirect URLs `https://<domain>/**` and the project's `https://bpmsquare-<slug>.vercel.app/**` (remove the second after go-live).
10. Authentication > Sign In / Providers: **Allow new users to sign up OFF** (the app never signs people up; invites still work). Leave **Confirm email** on.
11. Still to do (not done on 2026-10-26): custom SMTP (needed for invite e-mail without a password) and the invite template `supabase/email-templates/invite-user.html` re-worded for the client (`dedicated-instance.md` section 6).

### 4. Vercel project (owner creates, then the settings)
1. vercel.com/new, import `iammuniraa-wq/bpmsquare-app` into the **Pro team** (its address is `vercel.com/munira1/...`). Project name `bpmsquare-<slug>`.
2. Press **Create Project**, **not Deploy**: it creates the project without building, so settings can be set first. (The import screen has no branch picker; it shows `main`.)
3. Settings > Environments > Production > Branch Tracking: type `instance/<slug>` and **Save**. (The Git settings page does not hold this.) The new project's Ignored Build Step is "Automatic": leave it; the repo's script lives only on the shared project.
4. Settings > Environment Variables, **Production only** (so a preview deployment can never reach the client's database):
   - non-secret, type Config: `NEXT_PUBLIC_SUPABASE_URL` = the project URL.
   - secret, type Secret, pasted by the owner: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and the six from `node scripts/dedicated/gen-secrets.mjs` (`FIELD_ENCRYPTION_KEY` first into the password manager: it cannot be rotated and the data is unreadable without it), then `RESEND_API_KEY`, `RESEND_SENDING_DOMAIN`, `RESEND_WEBHOOK_SECRET`, `RESEND_INBOUND_WEBHOOK_SECRET`, `INBOUND_EMAIL_DOMAIN`, `ANTHROPIC_API_KEY` when the client agrees.
5. Settings > Domains > Add Existing > `<domain>` > Connect to **Production**.
6. DNS at the client's DNS host (for `bpmsquare.com` that is **IONOS**): a **CNAME**, name = the sub-domain (`kamco`), value = the target the Vercel Domains page shows under "View DNS configuration" (KAMCO: `c8a90f34b9120e4f.vercel-dns-016.com`). Wait for "Valid Configuration" before anyone logs in (secure cookies need the certificate).
7. Redeploy (or push to `instance/<slug>`). Confirm in the build log the function region is the one set.

### 5. The tenant (on the NEW app, never the shared one)
1. Sign in at `https://bpmsquare-<slug>.vercel.app/login` as the operator (first create the same address in Supabase > Authentication > Users with "Auto confirm user"; the `platform_admins` row already exists).
2. `/admin/tenant-studio` (needs `ANTHROPIC_API_KEY`) or `/admin/tenants/new` (the form). **Check the address bar first**: the studio writes into the database of the app it is open on. The address bar is the proof of which database you are on. (The studio's "still yours to do" list always prints the fixed words "Project bpmsquare-app (team veveycrm)": it is hard-coded text, not evidence of the app.)
   **Plan:** the database accepts only `personal`, `small_business` or `enterprise`; ask for "Plan enterprise" in the text. Older studio builds let the AI write other words ("professional", "starter") and Create then failed with `tenants_plan_check`; a code fix now maps them.
3. Text used for the studio (KAMCO): *"KAMCO, a Saudi Arabian contracting company (Dammam, Eastern Province) that bids on Aramco and other tenders and runs the awarded work as projects. Currency SAR. Timezone Asia/Riyadh. Slug kamco. Domain kamco.bpmsquare.com. Admin alias off sap.rashid@gmail.com. Modules: Pipeline (deals and tenders), Accounts and Contacts, Products, RFQ (supplier quotes), Estimates, Standard Quotes, Inbox (shared email). No Workforce, no Service, no Marketing, no Invoices. Hide every navigation item for modules they did not buy. Create no sample users and no employees: only the admin. English only."* The plan it drafted: 9 modules (pipeline, accounts, contacts, products, rfq, estimator, standard_quotes, outbound_email, administration), one admin, `/process-studio` hidden. Press **Create tenant** only on the new app.
4. In `/admin/tenants/<id>` set the flags the studio never sets: `gcc_tender`, `deal_room`, `contract_projects`, the real `inbox` flag, and **Settings > Email output = redirect** until the smoke tests pass (a non-demo workspace sends real e-mail by default).
5. Timezone in Settings; first login as the tenant admin on the real domain; forced password change.

### 6. After
Smoke tests (`dedicated-instance.md` section 14), backups and a restore test (section 13), release routine (section 12: merge `main` into `instance/<slug>`; new migrations then apply by themselves; **back up first**), update the ledger.

## Things that went wrong or nearly did (so they do not again)
- A hosted Supabase region list has no Gulf region; Europe (Frankfurt) was agreed with the client instead.
- The Tenant Creation Studio was open on the **shared** app: pressing Create would have put the client in the shared database.
- The first Vercel deploy of the shared app failed on a Google Fonts download (`next/font/google`); an empty commit retriggered it. If it repeats, bundle the font.
- Vercel's Production Branch field ignored a programmatic fill; it has to be typed for the Save button to enable.
- The GitHub-driven migration apply needs the migrations folder cleaned first (item 2.3), otherwise another client's tenant is created in this database.
- Supabase's Leave-site prompt can stay "dirty" after saving; verify saved values from a fresh tab.
- Secrets are never typed by the assistant: the owner pastes them; the assistant enters only non-secret values.
