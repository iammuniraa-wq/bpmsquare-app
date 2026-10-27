# Dedicated instance runbook

> **Snapshot 2026-10-26**, written against `develop` at `7c500f0d` (173 migration files, 21 cron routes).
> Audience: the operator who stands up one private BPMSquare for one client (first client: KAMCO, Gulf).
> Companion files: `scripts/dedicated/build-fresh-schema.mjs` (builds and checks the database),
> `scripts/dedicated/bootstrap.sql` (the first rows), `scripts/dedicated/dump-prod-schema.md` (compare with production).
> Parent runbook: `TENANT_PROVISIONING.md` (section 0 points here; sections 1 to 6 are followed unchanged for the tenant itself).
> Nothing here was run against a live system. The kit was written without access to any database or cloud account, so
> every command is to be run by the operator and every claim about a vendor's behaviour is marked "verify" where it
> could not be checked from the repo.

A dedicated instance is **the same codebase** with **its own Supabase project (or self-hosted Supabase), its own Vercel
project, its own keys and its own domain, holding one client.** Isolation is physical (a separate database) on top of
the usual row-level security. It is a recurring cost: every future migration must be run on this database too, forever
(section 12).

```
 client browsers ──https──> Vercel project "bpmsquare-<slug>" ──https──> Supabase (hosted OR self-hosted)
                              (own env vars, own crons)                   Postgres + Auth + Storage + Realtime
                                   │
                                   ├── Resend (e-mail out and in)           leaves the region
                                   ├── Anthropic API (AI features)          leaves the region
                                   └── optional: AWS Rekognition, web push, client ERP / mailbox connectors
```

---

## 0. Decisions the owner must take first

| # | Decision | Options | Why it matters | Recommendation |
|---|---|---|---|---|
| D1 | **Where the database lives** | (a) Supabase hosted, nearest region (Mumbai `ap-south-1` or Frankfurt `eu-central-1`); (b) Supabase Enterprise / dedicated or bring-your-own-cloud in the Gulf, if Supabase offers it (question list, section 17); (c) self-hosted Supabase on AWS Bahrain / UAE | Hosted Supabase has no Middle East region in its published list (web search 2026-10-26 of Supabase's regions list found no Middle East region, the closest being Mumbai; confirm on supabase.com/docs/guides/platform/regions). If KAMCO's contract says "data in the Gulf", only (b) or (c) satisfies it. | Ask Supabase first (section 17). Build the kit so (a) and (c) are the same procedure. |
| D2 | **Where the app runs** | Vercel project with the region pinned (section 7) | The Vercel functions read and write every record in memory in their region. A Gulf database with the app in Seoul or Washington is not Gulf-resident compute. Vercel's region list must be checked for a Middle East region (verify on the Vercel regions page; the code cannot tell). | Pick the region closest to the database; say plainly in the contract which regions process data. |
| D3 | **AI features** | Set `ANTHROPIC_API_KEY` or leave it unset | With a key, prompts that contain record data go to Anthropic's API, outside the region (section 11). Without it every AI feature is off (`aiConfigured()` is false) and the product still works. | Owner and KAMCO decide; default off until agreed. |
| D4 | **E-mail provider** | Resend (as built) | Every business e-mail and every password-reset e-mail, and inbound e-mail, pass through Resend. A tenant may also send through its own SMTP connector (Settings > Connectors). | Owner decides whether KAMCO accepts Resend; ask for its region options. |
| D5 | **Operator access** | Who may hold the Supabase service-role key and the Vercel project | The service-role key bypasses row-level security. | Two named people, hardware-key MFA on both consoles. |
| D6 | **Deploy source** | Same `main` as everyone, or a long-lived `instance/<slug>` branch | `vercel.json` pins `"regions": ["icn1"]` (Seoul, next to the shared production database). That line wins over the dashboard setting (verify in the first build log) and applies to every project built from the file. | Branch `instance/<slug>` = `main` plus a one-line `regions` change, merged forward at every release (section 12). |
| D7 | **Brand of system e-mails** | Keep BPMSquare invite wording or re-word | The Supabase invite template (`supabase/email-templates/invite-user.html`) is BPMSquare-branded and describes the product as for "electromechanical repair & service businesses". | Edit the copy for KAMCO before inviting anyone. |

---

## 1. Checklist at a glance (do in this order; the number is the section that holds the detail)

- [ ] 0. Owner decisions D1 to D7 taken and written down
- [ ] 2. Host chosen; Supabase project or self-hosted stack created
- [ ] 3. Fresh schema built; production schema dumped and compared (once)
- [ ] 4. Schema applied on a scratch stack, then on the real one; `bootstrap.sql` run
- [ ] 5. Nine storage buckets present
- [ ] 6. Supabase Auth settings done
- [ ] 7. Vercel project, region, environment variables (7.1), crons (9)
- [ ] 8. Domain and DNS
- [ ] 10. First platform admin, tenant created, feature flags set, first login
- [ ] 11. External services configured (or deliberately left off) and the residency position agreed
- [ ] 14. Smoke tests pass
- [ ] 13. Backups running, restore test done, monitoring on, rollback understood
- [ ] 12. Ledger file created for the instance
- [ ] Handover to the client admin (`TENANT_PROVISIONING.md` section 6)

---

## 2. Choose the host and create the database

- [ ] **Hosted Supabase:** create a project in the chosen region. Choose a strong database password and keep it in the
      team password manager (never in the repo). Note the project URL, the `anon` key and the `service_role` key
      (Project Settings > API). Plan: a paid plan, because daily backups and no auto-pause matter for a client system
      (verify current plan terms with Supabase).
- [ ] **Self-hosted Supabase** (fallback, Docker, official compose): on an AWS Bahrain (`me-south-1`) or UAE
      (`me-central-1`) instance, follow Supabase's current self-hosting guide. What differs from hosted, and what this
      kit therefore needs from you:
      - Generate **fresh** `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, `SECRET_KEY_BASE`,
        dashboard credentials (the compose `.env.example` explains each; the two API keys are JWTs signed with
        `JWT_SECRET`, generate them from your own secret, never reuse the example values).
      - The app needs a **public HTTPS URL for the API gateway (Kong)**, because the browser talks to Supabase directly
        (`NEXT_PUBLIC_SUPABASE_URL`). Put it behind TLS on a hostname you control (for example `db.<client-domain>`), and
        restrict the Postgres port (5432) to the operator network. Do not expose Studio publicly.
      - Required services: Postgres, GoTrue (Auth), PostgREST, Storage, Realtime (used for "who else is viewing this
        record", `src/lib/usePresence.ts`; the product works without it, the indicator does not), Kong. Not used by the
        app: Edge Functions, Analytics/Logflare, imgproxy (leave off if you wish), `vector`.
      - Storage must be **healthy before the schema is applied**: the migrations insert rows into `storage.buckets`.
      - You own backups, upgrades, disk, monitoring and security patches (section 13, cost note section 15).
- [ ] Record in the instance ledger (section 12): host type, region, Postgres major version, date, operator.

The app needs only three things from any Supabase endpoint: its URL, the anon key, the service-role key, plus the
same schema, Auth behaviour and Storage buckets. Nothing in the code is specific to the hosted product (no Edge
Functions, no `pg_cron`, no `pg_net`, no extension beyond `pgcrypto` and `pg_trgm`).

---

## 3. Build the fresh schema

```bash
git checkout main            # or instance/<slug>; the build reads supabase/migrations/ of the checkout
node scripts/dedicated/build-fresh-schema.mjs
# writes dist/dedicated/fresh-schema.sql and dist/dedicated/fresh-schema-report.md (dist/ is git-ignored)
```

Read `fresh-schema-report.md`. The script exits 1 if the reader finds anything that cannot run on a clean database.
Keep the report with the instance ledger (it carries the overall and body hashes of what you apply).

### 3.1 Verdict: can the repo alone create a working database? (evidence, 2026-10-26)

**Partly yes.** The files form a replayable history by themselves, with three exceptions that need an owner action.

What was checked (static replay of all 172 files in order, no database available to execute them):

| Question | Finding | Evidence |
|---|---|---|
| Is the order well defined? | Yes. `0000_baseline.sql`, then `0030`+ numerically. The archived `0001`-`0029` must NOT be applied. | `supabase/migrations_legacy/README.md`; baseline header lines 1-6; the baseline replays 0007-0027 inside its addendum |
| Does any file use an object created only by a later file or by nothing? | **No**, for tables, columns named in `ALTER`/`CREATE INDEX`/`INSERT`, foreign keys, policies, triggers, `DROP POLICY`. 199 tables are created; every reference resolves earlier in the order. The reader was proven by removing `0120_opportunities.sql`: it then reports 8 errors in `0128`, `0181`, `0212`, `0220`, `0222`, `0223`. | `src/lib/dedicated/freshSchema.test.ts` pins this on every test run (it replays the real folder) |
| Numbering gaps | `0110, 0134, 0135, 0147-0149, 0153-0159, 0163, 0164, 0173, 0174, 0179, 0184, 0189, 0193, 0194, 0218` never existed in git history (`git log --all` finds no file); `0179` is declared "deliberately unused" in `PROJECT.md`. They are not missing files. Bundle 29 is absent for the same reason. | git history; `PROJECT.md` line 581 |
| Extensions | `pgcrypto` (baseline line 15) and `pg_trgm` (`0045_global_search_trgm.sql` line 6), both `create extension if not exists`. Both ship with Supabase. `gen_random_uuid()` is core Postgres 13+. | grep of `create extension` over the folder |
| Supabase-provided objects assumed | `auth.users`, `auth.uid()`, `storage.buckets`, `storage.objects`, `storage.foldername()`, roles `anon`, `authenticated`, `service_role`. Present on hosted and on the official self-hosted compose. **Not** on plain Postgres. | baseline lines 794-815; `0038_storage_tenant_isolation.sql`; `0200_tenants_hide_api_key.sql` |
| Transaction safety | No `CREATE INDEX CONCURRENTLY`, no `ALTER TYPE ... ADD VALUE`, no `BEGIN/COMMIT`. The build can run as one transaction (`psql -1`), so a failure leaves nothing half-applied. | grep over the folder |
| `do $$` guards | Present and read as guarded (they only widen CHECK lists where a table exists, or backfill). They do nothing on a clean database except where noted. | `0105`, `0140`, `0202`, `0214`, `0220` |
| Storage buckets | 8 buckets are created by migrations: `company-assets`, `logos` (public) and `wfm`, `quote-attachments`, `order-attachments`, `inbox-attachments`, `deal-room-files`, `tender-boq-files` (private). | the `insert into storage.buckets` statements; report table |

The three exceptions:

1. **`case-photos` bucket is not created by any migration**, yet the code uses it
   (`src/app/api/cases/[id]/photos/route.ts` lines 78, 83, 138; it serves photos through `getPublicUrl`, so the bucket
   must be public). On production it was made by hand. `bootstrap.sql` creates it for the new instance.
2. **The baseline seeds the owner and a pilot tenant.** `0000_baseline.sql` line 30 inserts the owner's e-mail into
   `platform_admins`; lines 61-78 insert a tenant `vikas` ("Vikas Pioneers", the BPMSquare Demo pilot). On a dedicated
   instance that would put another client's tenant and the owner's account into KAMCO's database. The builder
   **comments both statements out** (listed in the file header; `--keep-baseline-seeds` restores them). It also
   **leaves out `0031_copy_vikas_pioneers_entity_profile.sql`**, a pure data copy carrying Vikas Pioneers' GSTIN,
   phones and address (`--include-client-data` restores it). `0032`, `0056`, `0060` and `0085` still run; they update
   rows by a hard-coded id, slug or `is_demo` flag and match nothing on a clean database.
3. **Production drift (not provable from the repo).** Production is a database that migrations were pasted into by
   hand, and it has been found behind or ahead of the repo before (`PROJECT.md` ledger; the 2026-08-06 outage where
   `0057` was never run; `0047_schema_drift_reconcile.sql` exists because production had columns no file declared).
   A heuristic scan of the application against the migrations finds three columns the code reads that no migration
   adds: `service_cases.created_at` (`src/app/api/cases/[id]/route.ts:19`), `work_orders.created_at`
   (`src/app/api/work-orders/[id]/route.ts:18`) and `assets.created_at` (`src/lib/account360/server.ts:93`). If
   production has them, they were added by hand; if it does not, those reads fail quietly. Either way the repo build
   and production differ. **Run `scripts/dedicated/dump-prod-schema.md` once before the KAMCO build** and turn every
   production-only object into a guarded migration (the `0047` pattern). Until then treat the repo build as "likely
   complete, not proven".

Limits of the reader (so nobody over-trusts the green result): it does not execute SQL; it does not resolve
references inside `plpgsql`/`sql` function bodies or `execute format(...)` strings (late-bound); it checks columns
only for `CREATE INDEX`, `ALTER ... COLUMN`, `DROP COLUMN`, `INSERT` column lists and a few more, not every
expression. The authoritative test is section 4 step 2: applying the file to an empty scratch Supabase with
`ON_ERROR_STOP`.

---

## 4. Apply the schema and bootstrap

1. [ ] **Rehearse on a scratch stack first** (Supabase CLI local stack, or a throwaway hosted project). Apply exactly
       the file you intend to apply to the real instance:
       ```bash
       psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f dist/dedicated/fresh-schema.sql
       ```
       `$DB_URL` is the **direct** connection string (port 5432, or the session pooler), not the transaction pooler.
       The file is about 10,800 lines; the dashboard SQL editor is the wrong tool for it. If it fails, the message names
       the statement; fix the repo with a new migration and rebuild, never edit the generated file.
2. [ ] Apply to the real instance the same way. Record in the ledger the `overall-sha256` and `body-sha256` printed in
       the file header.
3. [ ] Edit the one line in `scripts/dedicated/bootstrap.sql` (`v_email`, the operator's address) **in your working
       copy only, never committed**, then:
       ```bash
       psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/dedicated/bootstrap.sql
       ```
       It inserts the platform-admin row, creates the `case-photos` bucket and prints a checklist. Every line should say
       `ok`. If the last check says `NO GRANT`, the API roles cannot read the tables; on current Supabase hosted and the
       official compose, default privileges grant them, but this has changed over time (verify): then run, as the
       database owner, `grant usage on schema public to anon, authenticated, service_role;` and
       `grant all on all tables in schema public to authenticated, service_role;` and re-run, **but do not grant
       `tenants.api_key`** (migration 0200 withdrew it; re-check the "tenants.api_key hidden" line after any grant).
4. [ ] Confirm the Supabase API exposes the `public` schema (hosted: Project Settings > API > Exposed schemas).

Never run `supabase/seeds/vikas_pioneers_seed.sql`, `supabase/seed_cases.sql`, `supabase/PRODUCTION_CATCHUP.sql` or any
`scripts/seed-*.sql` on this database.

---

## 5. Storage buckets

Nine buckets must exist after step 4. The migrations create eight; `bootstrap.sql` creates the ninth.

| Bucket | Public | Used for | Created by | Access path |
|---|---|---|---|---|
| `company-assets` | yes | logos, partner logos (`/api/upload`) | baseline | tenant-folder policies (0038) |
| `logos` | yes | tenant logo (`/api/admin/upload-logo`) | 0038 | admin-only policies |
| `case-photos` | yes | service-case photos | **`bootstrap.sql`** | service role only |
| `wfm` | no | face enrolment / attendance images | 0062 | service role only |
| `quote-attachments` | no | standard-quote attachments | 0119 | service role, signed URLs |
| `order-attachments` | no | sales-order attachments | 0212 | service role, signed URLs |
| `inbox-attachments` | no | shared-inbox attachments (15 MB limit) | 0214 | service role, signed URLs |
| `deal-room-files` | no | Deal Room files (15 MB limit) | 0222 | service role, signed URLs |
| `tender-boq-files` | no | tender BOQ uploads (15 MB limit) | 0223 | service role, signed URLs |

- [ ] Check in Storage that all nine are present and that the six private ones show **Private**.
- [ ] Self-hosted: the storage service has its own global upload limit (check `FILE_SIZE_LIMIT` in your compose; the
      app allows up to 15 MB on the newer buckets).
- [ ] Database backups do **not** contain the files in storage. Section 13 covers them.

---

## 6. Supabase Auth settings

Derived from the code (the app only calls `signInWithPassword`, `exchangeCodeForSession`, `verifyOtp`, `setSession`,
`updateUser`, and the admin API: `createUser`, `inviteUserByEmail`, `generateLink`, `updateUserById`, `listUsers`,
`getUserById`; it never calls `signUp`).

Hosted dashboard names, with the self-hosted compose variable in brackets (names as in the official `.env.example`;
confirm against the version you pull).

- [ ] **Site URL** (`SITE_URL`): `https://<client-domain>` (the production domain, section 8).
- [ ] **Redirect URLs** (`ADDITIONAL_REDIRECT_URLS`): `https://<client-domain>/**`, and for the first sign-in before
      DNS is ready, `https://<vercel-project>.vercel.app/**`. Remove the Vercel URL after go-live. Every invite and reset
      link is built from the tenant's own origin and lands on `/auth/callback`; a host missing from this list sends the
      user to the Site URL, which presents as "password reset loops" (`TENANT_PROVISIONING.md` section 2 step 4).
- [ ] **Disable new signups** (`DISABLE_SIGNUP=true` / "Allow new users to sign up" off): the app never signs people
      up; every account is created by an admin or an invite. Admin `createUser` and `inviteUserByEmail` are not blocked
      by this setting (verify in the smoke test, section 14, step 3).
- [ ] **Email provider on, password sign-in on.** Keep "confirm email" at its default: accounts the app creates are
      created already confirmed (`email_confirm: true`, `src/app/api/business-users/[userId]/route.ts`), and there are no
      confirmation links anywhere in the product.
- [ ] **JWT expiry** (`JWT_EXPIRY`): keep the default 3600 s. No code depends on a particular value; the proxy
      refreshes sessions through `@supabase/ssr`. Do not set it very short (every page does an auth round trip) and do
      not enable anything that forces re-login on tab focus.
- [ ] **SMTP** (custom SMTP; `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME`):
      needed for `inviteUserByEmail`, which is used when a workspace admin invites someone **without** setting an
      initial password (`/api/settings/team`, `/api/business-users`, tenant invites, resend-invite). Password-reset
      e-mail does **not** use it: the app builds the link with `generateLink` and sends it itself through Resend
      (`src/app/api/auth/request-reset/route.ts`). The hosted built-in mailer is for testing only; use the client's or
      your own SMTP with a verified sender domain.
- [ ] **Email template "Invite user":** paste `supabase/email-templates/invite-user.html`, subject
      `You're invited to {{ .Data.tenant_name }} on BPMSquare`. It reads `{{ .Data.tenant_name }}`, which the app passes.
      Re-word per D7. Leave the other templates at default (the recovery and magic-link tokens the app generates are
      consumed by its own `/auth/callback`, never mailed by Supabase).
- [ ] Do not enable an external OAuth provider, CAPTCHA, phone sign-in or anonymous sign-ins: nothing in the app
      handles them. Passkeys and face login are the app's own and sign in through `generateLink`.
- [ ] Rate limits: leave at defaults; the app adds none of its own on `/login` (noted open in
      `MULTI_TENANT_GUARDRAILS.md`).

---

## 7. Vercel project

- [ ] **Team and plan.** Create the project in the team you will bill the client from (or the client's own team if the
      contract says so). Pro or above: the repo schedules sub-daily crons (every 5 and 15 minutes) and sets a function
      memory of 1600 MB for the quote PDF routes; confirm the limits of the plan you choose (verify).
- [ ] **Import** the repository, framework Next.js, default build and output settings, Node 20+.
- [ ] **Production branch:** `main`, or `instance/<slug>` (D6). The repo's Ignored Build Step script
      (`scripts/vercel-ignore-build.sh`, set in the dashboard, not in the repo) skips every branch except `main` and
      `develop` and skips docs-only pushes; if you deploy from `instance/<slug>` either leave the Ignored Build Step empty
      or add the branch to the script on that branch.
- [ ] **Region.** `vercel.json` contains `"regions": ["icn1"]`. For this instance set it to the Vercel region
      nearest the database (D2; verify the code against Vercel's regions page). With D6 as recommended this is the only
      line that differs on `instance/<slug>`. After the first build, confirm the region in the deployment's Functions tab.
- [ ] **Environment variables:** section 7.1 below; add them for the Production environment before the first deploy
      (`NEXT_PUBLIC_*` values are baked in at build time: change one and you must redeploy).
- [ ] **Crons:** automatic from `vercel.json` (list in section 9, "Crons"). They are sent `Authorization: Bearer $CRON_SECRET`
      by Vercel when `CRON_SECRET` is set in the project.
- [ ] **Deployment protection:** keep Vercel's authentication off for the production domain (users are not Vercel
      users); keep it on for preview deployments, or disable previews for this project (they would run against the
      client's database).
- [ ] **Do not** connect the preview environment to this database unless you intend previews to touch client data.

### 7.1 Every environment variable the app reads

Derived by scanning `process.env.*` over `src/`, `scripts/`, `mcp-server/`, `mobile/` and `next.config.ts` (no test
files), 2026-10-26. `vercel.json` defines none. A variable marked **fresh** must be generated for this instance and
must differ from every other instance and from the shared production values.

Generate a strong value with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (64 hex
characters), unless the row says otherwise.

**Needed for the app to start and sign people in**

| Variable | Purpose | Where from | Secret | Fresh | If missing |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL, used by browser and server | Supabase project URL, or your Kong URL | no (public) | yes (per project) | App cannot read or write anything; every page errors. Build-time: redeploy after a change. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key for browser and session clients | Supabase API settings | no (public by design; RLS is the control) | yes | Login and every session read fail. Build-time. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key that bypasses RLS (admin client, proxy tenant resolution, tenant provisioning). Also the **seed of three derived signing keys**: kiosk punch tickets (`src/lib/wfm/kiosk.ts`), passkey challenge cookies (`src/lib/passkeys.ts`) and, unless `ASSISTANT_ACTION_SECRET` is set, assistant action and consent tokens | Supabase API settings | **yes** | yes (per project) | Proxy cannot resolve tenants; everything fails. Never expose to the browser; rotating it invalidates in-flight kiosk tickets and passkey challenges (harmless, short-lived). |
| `FIELD_ENCRYPTION_KEY` | AES-256-GCM key for PII (account and contact phone, e-mail, GSTIN), for sealed secrets in `tenants.config` and connector credentials, and the root of two blind-index keys (contact e-mail hash, WhatsApp number hash) and the form IP hash | generate, 64 hex characters | **yes** | **yes, never copied from production** | `encrypt()` silently stores **plaintext** and logs one error per process (`src/lib/encryption.ts`); blind-index functions throw. **There is no rotation tool.** Losing or changing it after data exists makes the encrypted fields unreadable. Escrow it (section 13). |
| `QUOTE_PUBLIC_LINK_SECRET` | HMAC key for every signed no-login link: quote and sales-order PDF links, marketing unsubscribe / interest / preference / confirm links, newsletter click and open links, form tokens; also fallback for the RFQ link key and the form IP hash | generate, 32+ random bytes | **yes** | **yes** | Those links are not generated (feature silently unavailable); marketing e-mails go out without working unsubscribe links, so do not send marketing without it. |
| `CRON_SECRET` | Bearer secret every cron route checks (constant-time). One variable for all 21 routes | generate | **yes** | **yes** | Every cron answers 401 and nothing runs: reminders, mailbox polling, ERP sync, webhooks, digests. The app works without them but quietly stops doing background work. |

**E-mail**

| Variable | Purpose | Where from | Secret | Fresh | If missing |
|---|---|---|---|---|---|
| `RESEND_API_KEY` | Sends every business e-mail, password-reset mail, WFM and tender notifications; also fetches inbound mail bodies | Resend (own account or sub-account for this client) | **yes** | yes | No e-mail leaves the system; password reset does not work (logged as an error). |
| `RESEND_SENDING_DOMAIN` | Domain of the From address (`<tenant-slug>@<domain>`) | A domain verified in Resend (DKIM, SPF) | no | yes | **Defaults to `bpmsquare.com`** in 16 places: a dedicated instance would send as BPMSquare's domain. Always set it to the client's own verified domain. |
| `RESEND_WEBHOOK_SECRET` | Verifies Resend delivery events (`/api/webhooks/resend`, Svix signature) | Resend webhook settings (`whsec_...`) | **yes** | yes | Delivery / bounce / complaint events are refused with an error log; bounce handling and e-mail health stop updating. |
| `RESEND_INBOUND_WEBHOOK_SECRET` | Verifies Resend inbound mail (`/api/inbound/email/resend`) | Resend inbound webhook | **yes** | yes | Inbound mail (RFQ replies, shared Inbox forwarding address) is rejected 401. |
| `INBOUND_EMAIL_DOMAIN` | Domain of each Inbox channel's forwarding address (`inbox-<random>@<domain>`) | A domain with Resend inbound MX | no | yes | Forwarding addresses cannot be formed; Intake A of the Inbox is off. |
| `INBOUND_EMAIL_SECRET` | HMAC for the generic inbound endpoint (`/api/inbound/email/generic`) | generate | **yes** | yes | Generic inbound refused 401. Only needed if you use that endpoint instead of Resend. |

**Link and action signing (optional separation; each has a fallback)**

| Variable | Purpose | Where from | Secret | Fresh | If missing |
|---|---|---|---|---|---|
| `RFQ_LINK_SECRET` | Signs supplier RFQ reply links | generate | **yes** | yes | Falls back to `QUOTE_PUBLIC_LINK_SECRET`. Set it only if you want the two separable. |
| `ASSISTANT_ACTION_SECRET` | Signs assistant "confirm card" action tokens and one-time data-consent tokens | generate | **yes** | yes | Falls back to a key derived from `SUPABASE_SERVICE_ROLE_KEY`. Setting it decouples them (recommended on a dedicated instance). |
| `CONNECTOR_OAUTH_STATE_SECRET` | Signs OAuth `state` for connectors | generate | **yes** | yes | No connector uses OAuth today (`src/lib/connectors/registry.ts`), so leave unset; set it only when one does. |

**AI**

| Variable | Purpose | Where from | Secret | Fresh | If missing |
|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | All AI features: assistant, Talk to data, import extraction, estimator and BOQ reading, Tenant Creation Studio drafting, company analysis | Anthropic console (own key for this client, so usage and revocation are separable) | **yes** | yes | AI features are off (`aiConfigured()` false); the Tenant Creation Studio cannot draft (use the form at `/admin/tenants/new`). **Residency: see section 11.** |
| `ASSISTANT_SMALL_MODEL` | Name of the cheaper model the assistant uses for small tasks | Anthropic model list | no | no | Built-in default is used. |

**WFM and other optional features**

| Variable | Purpose | Where from | Secret | Fresh | If missing |
|---|---|---|---|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web-push for WFM notifications | `npx web-push generate-vapid-keys` | private key **yes** | **yes (a pair)** | Push notifications off (`pushConfigured()` false). Changing the pair later unsubscribes every device. |
| `VAPID_SUBJECT` | Contact the push service can reach | `mailto:` address of the operator | no | yes | **Defaults to `mailto:support@bpmsquare.com`**: set your own. |
| `FACE_AWS_ACCESS_KEY_ID`, `FACE_AWS_SECRET_ACCESS_KEY`, `FACE_AWS_REGION` | AWS Rekognition for face punch and kiosk | An IAM user limited to Rekognition in the chosen region | secret key **yes** | yes | Face punch cannot work (logged). `FACE_AWS_REGION` defaults to `ap-south-1` in code if the other two are set without it: always set it explicitly. Face collections are per tenant at AWS. |
| `OLA_MAPS_API_KEY` | Reverse-geocodes punch coordinates to addresses (an India map provider) | Ola Maps | **yes** | n/a | Coordinates are shown instead of addresses. Not useful in the Gulf; leave unset. |
| `PROCESS_STUDIO_NOTIFY_EMAIL` | Where Process Design Studio "Talk to us" requests go (overridden by the platform setting) | operator address | no | yes | Requests are not mailed until the platform setting is set in `/admin`. |
| `NEXT_PUBLIC_GUIDE_BASE_URL` | Base address of the how-to guide for "Learn more" links | where the guide is hosted | no | n/a | No "Learn more" links are drawn. Build-time. |

**Set by the platform, never by you:** `NODE_ENV` (Next.js; `production` switches on secure cookies and hides the
`/api/auth/dev-signin` route), `VERCEL` (Vercel; PDF routes use it to pick the bundled Chromium).

**Scripts only (not read by the running app):** `scripts/*` read `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and `FIELD_ENCRYPTION_KEY` from the environment; `scripts/sap-s4-smoke.mjs` reads
`SAP_API_HOST`, `SAP_USER`, `SAP_PASSWORD`, `SAP_API_KEY`. None is needed to stand up a new instance. Do not run
`scripts/push-seed-to-supabase.mjs`, `seed-*.mjs` or `encrypt-existing-pii.mjs` against it.

**Dynamic names:** `src/lib/connectors/server.ts` and the connector OAuth routes read `process.env[<name from a
connector definition>]`; no definition declares OAuth today, so no extra variable exists.

- [ ] All **fresh** values generated, stored in the team password manager and in the client escrow (section 13).
- [ ] No value copied from the shared production project, from `.env` files, or from this document.

---

## 8. Domain and DNS

Tenants are resolved **by hostname**: the host must equal the tenant's `custom_domain` (`src/proxy.ts`,
`resolveHostTenant()`). Wire the domain before anyone logs in as a tenant user.

- [ ] Choose the client's address, for example `app.<client-domain>`. It must be a host you can add a Vercel domain
      for and (best) a host on the client's own domain, so the client controls the certificate path.
- [ ] Vercel > project > Settings > Domains > Add the host. Add the DNS record the dashboard shows (a CNAME to the value
      Vercel gives, `cname.vercel-dns.com` at the time of writing, or an A record for an apex).
- [ ] Wait for **Valid Configuration** and an issued certificate. While it says "Generating SSL Certificate" the site
      answers over plain HTTP: **do not log in yet** (session cookies are secure-only in production).
- [ ] Add the host to Supabase's redirect allowlist (section 6) if not already.
- [ ] E-mail DNS: SPF, DKIM, DMARC for `RESEND_SENDING_DOMAIN` (Resend shows the records); MX for
      `INBOUND_EMAIL_DOMAIN` if the shared Inbox forwarding address is used.
- [ ] The first platform-admin sign-in (step 9) happens on the project's `*.vercel.app` URL before DNS is ready:
      `/admin/**` works there because it needs only a platform admin, not a tenant host.

---

## 9. Crons

Defined in `vercel.json`; Vercel calls each with `GET` and `Authorization: Bearer $CRON_SECRET`. All 21 use the one
`CRON_SECRET` and answer **401** without it. Each acts only on workspaces that own the relevant module and flag, so on
a one-client instance most are no-ops until that module is switched on.

| Route | Schedule (UTC) | What it does | Needs beyond `CRON_SECRET` |
|---|---|---|---|
| `/api/wfm/cron/retention` | daily 20:00 | purges attendance selfies older than the workspace's `selfie_retention_days` (the punch event stays) | WFM on |
| `/api/webhooks/cron` | daily 20:30 | delivers each active webhook's change-feed backlog, signed | outbound HTTPS |
| `/api/wfm/cron/hours-alert` | every 15 min | push alerts to employees about their hours | WFM; VAPID (push only, no e-mail) |
| `/api/pricing/cron/retention` | daily 20:15 | purges stored pricing contexts past retention | pricing engine on |
| `/api/wfm/cron/project-invoices` | 1st of month 00:30 | month-end draft project invoices | WFM project billing |
| `/api/wfm/cron/saturday-roster` | 25th of month 03:00 | generates next month's alternate-Saturday roster and holidays | WFM |
| `/api/wfm/cron/holiday-week` | Mondays 03:00 | pushes the week's upcoming holidays to employees (silent in a week with none) | WFM; VAPID |
| `/api/rfqs/cron/mailbox` | every 5 min | reads the RFQ mailbox (IMAP) and files replies | `rfq` on, mailbox connector |
| `/api/rfqs/cron/reminders` | daily 05:00 | supplier reminders and expiry | `rfq`; Resend |
| `/api/connectors/cron/dynamics365` | hourly :10 | Dynamics 365 sync | D365 connector configured |
| `/api/connectors/cron/sap_s4` | hourly :25 | SAP S/4HANA sync | SAP connector configured |
| `/api/marketing/cron/journeys` | every 5 min | moves marketing journeys forward | marketing + Journeys flag; Resend |
| `/api/marketing/cron/attribution` | every 3 h | marketing attribution | marketing + Attribution flag |
| `/api/events/cron/invoice-overdue` | daily 20:45 | emits `invoice.overdue` events | invoices |
| `/api/events/cron/score-leads` | every 15 min | lead scoring | `marketing_scoring` |
| `/api/signals/cron/rescore` | every 3 h | buying-signal account rescoring | marketing + `buying_signals` |
| `/api/middleware/cron/prune` | hourly :50 | prunes integration-middleware payloads after 48 h | none (visits every workspace) |
| `/api/inbox/cron/mailbox` | every 5 min | reads connected Inbox mailboxes (IMAP, read-only) | `inbox`, mailbox connected |
| `/api/inbox/cron/purge` | daily 20:40 | Inbox retention (90 / 30 days) | `inbox` |
| `/api/tenders/cron/reminders` | daily 04:30 | tender closing-date reminders (7, 3, 1 days, day of) | `gcc_tender`; Resend |
| `/api/tenders/cron/room-digest` | every 15 min | Deal Room unread digest e-mail | `gcc_tender` + `deal_room`; Resend |

- [ ] After the first deploy, Vercel > project > Settings > Cron Jobs lists all 21.
- [ ] Verify one: section 14, step 7.

---

## 10. First platform admin, tenant, flags, first login

1. [ ] **Auth user:** Supabase dashboard > Authentication > Users > Add user: the operator's e-mail, a strong
       password, "Auto confirm user" ticked. (Self-hosted: same in Studio.) `bootstrap.sql` already holds the matching
       `platform_admins` row (step 4); `user_id` links itself on first sign-in.
2. [ ] **Sign in** at `https://<project>.vercel.app/login`. Platform-admin menus are under `/admin`.
3. [ ] **Create the tenant** exactly as `TENANT_PROVISIONING.md` sections 0, 1 and 4 say: open
       `/admin/tenant-studio` (preferred) or `/admin/tenants/new` (the form; use it if `ANTHROPIC_API_KEY` is unset).
       Inputs decided with the owner before you start: name, slug (short, lowercase, permanent), **custom domain = the host
       from section 8 (required)**, currency (`SAR`, `AED`...), module package, admin alias e-mail (plus-alias of the
       operator's mailbox) and initial password. Real client tenants are never created by SQL.
4. [ ] **Feature flags** (the studio never sets the platform-admin-only ones; set them in `/admin/tenants/<id>`):
       - the modules the contract sells (`pipeline`, `standard_quotes`, `products`, `rfq`, `inbox`, `invoices`, etc.);
       - `gcc_tender` (Tenders tab on the Pipeline; **needs `pipeline`**);
       - `deal_room` (**needs `gcc_tender`**);
       - `contract_projects` is not built yet (no such flag exists in `TenantFeatures` at `7c500f0d`); add it when slice 5a ships;
       - leave `next_experience`, `enterprise_theme`, `spectacular_theme` off unless the owner gives an explicit go
         (`bpmsquarecore.md` section 10 rule 1).
       Also in the tenant: **Settings > Email output**: set mode **redirect** to a controlled inbox until the smoke
       tests pass, then switch to partners (a non-demo workspace sends real e-mail to real addresses by default).
5. [ ] **Domain** (section 8) must be live and show Valid Configuration before the next step.
6. [ ] **First login as the tenant admin** on `https://<client-domain>/login` with the alias and initial password; the
       forced password change appears. Then verify scoping per `TENANT_PROVISIONING.md` section 3.
7. [ ] Remove the `*.vercel.app` URL from the Supabase redirect allowlist.
8. [ ] Handover later per `TENANT_PROVISIONING.md` section 6 (client names their admin; remove the alias and any
       plain-email platform-admin membership).

---

## 11. External services per instance, and what leaves the region

Say these plainly to KAMCO. Everything below is a processor of client data unless stated.

| Service | Used for | What it receives | Leaves the Gulf? | Switch off |
|---|---|---|---|---|
| **Supabase** (database, auth, storage) | all records, logins, files | everything | depends on D1 | n/a |
| **Vercel** (compute, build, logs, CDN) | runs the app, serves the pages | every request and response in memory in the function region; request logs; static assets cached worldwide at edge | The function region is chosen (D2); logs and the CDN edge are Vercel's | n/a |
| **Resend** | all outbound business e-mail, password-reset e-mail, inbound parse for RFQ replies and the shared Inbox | recipients, subjects, bodies, attachments (quotes as PDF links), inbound mail | **Yes** (provider's infrastructure; ask Resend for its region options, verify) | per-tenant SMTP connector replaces Resend for some mail; D4 |
| **Anthropic API** | assistant, Talk to data, import and BOQ extraction, estimator, company analysis, Studio drafting | prompts containing the record data needed to answer (names, amounts, document text, uploaded BOQ/drawing content for extraction) | **Yes** (Anthropic's infrastructure; check its data-retention and region terms, verify) | leave `ANTHROPIC_API_KEY` unset (D3); the assistant also asks consent per use and has a workspace read-access setting, but those limit what is sent, not where it goes |
| **AWS Rekognition** | face punch / kiosk | face images and templates | set by `FACE_AWS_REGION`; verify the service exists in the chosen Gulf region | leave unset; WFM face features off |
| **Web push** (browser vendors' push services) | WFM notifications | small payloads via Google / Apple / Mozilla push endpoints | **Yes** | leave VAPID unset |
| **Ola Maps** | geocoding punch coordinates | latitude and longitude | **Yes** (India) | leave unset (recommended in the Gulf) |
| **WhatsApp** | marketing WhatsApp | nothing yet: only a logging sandbox is built, no live provider is chosen (`src/lib/marketing/whatsapp/provider.ts`) | n/a today; decide when a provider is chosen | n/a |
| **Client's own systems** (Dynamics 365, SAP S/4HANA, IMAP/SMTP mailbox, Slack, calendar) | connectors the client configures | whatever the client enables | the client's choice | the client's connector settings |
| **User's browser, third parties** | map picker loads OpenStreetMap tiles and Leaflet icons from `unpkg.com` | the user's IP and viewed map area (not server data) | **Yes** | WFM site map only |

Not integrated yet, so no data flows: ZATCA e-invoicing submission, WPS / Mudad files, any payment provider.

Summary for the owner's decision: with D1 (c) and Resend and Anthropic switched off, the data at rest stays in the
Gulf; the compute (Vercel functions) stays there only if D2 finds a Gulf region. With them switched on, e-mail
content and AI prompts leave the region by design.

---

## 12. Upgrade procedure and the per-instance ledger

Every future migration that reaches the shared production project must also be run here, in order, or the new code
will misbehave (the app degrades cleanly on a missing table, but features go quiet). There is no automatic apply.

**The ledger.** Keep one file per instance in the repo at `docs/instances/<slug>.md` (no secrets), the equivalent of
the PROJECT.md operational ledger but for this database only:

| Field | Example |
|---|---|
| Host, region, Postgres version | self-hosted, me-central-1, 15.x |
| Vercel project, branch, region | `bpmsquare-kamco`, `instance/kamco`, `<region>` |
| Built from commit | `7c500f0d` |
| Fresh schema hashes | overall `...`, body `...` (from the file header) |
| Highest migration applied | `0224_rfq_awards.sql` |
| Applied after the fresh build | list of `NNNN_name.sql` with date and who |
| Pending | list, with the release that needs them |
| Last restore test | date, result |

**Release routine** (every time `main` moves):

1. [ ] `git log --diff-filter=A --name-only <last-built-commit>..main -- supabase/migrations` lists the new migration
       files; the ledger's "highest migration applied" tells you where you were. Also read the commit messages: they
       name any one-off SQL.
2. [ ] Back up the instance database (section 13). Never migrate without a fresh backup.
3. [ ] Run each new migration in filename order: `psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/NNNN_x.sql`.
       Run the matching `scripts/run-bundle-*.sql` only if you prefer the owner's pasted bundles; they contain the same SQL
       (check the bundle's file list against the migration list).
4. [ ] Run the checker against the new state: `node scripts/dedicated/build-fresh-schema.mjs` must exit 0.
5. [ ] Update `instance/<slug>`: `git merge main` (the region line is the only expected conflict), push, wait for the
       deployment, confirm the Production badge sits on the newest deployment (a rollback pins production;
       `DEPLOYMENT_GUIDELINES.md`).
6. [ ] If the release adds a tenants column, its migration must grant it (`0200`; enforced by
       `src/lib/tenantsColumnGrants.test.ts`).
7. [ ] If the release adds an environment variable, add it in Vercel and redeploy.
8. [ ] Smoke test (section 14, the short form: steps 1, 2, 7) and update the ledger.

Order matters between migrations and code: for a release that **adds** schema, run the SQL first, then deploy. For a
release that **removes** schema (rare), deploy first, then run the SQL.

---

## 13. Backups, restore test, monitoring, rollback

### Backups

- [ ] **Database.** Hosted: use a plan with daily backups, and point-in-time recovery if the contract needs a
      recovery point objective under a day (verify what the plan includes). Self-hosted: scheduled `pg_dump -Fc` to
      encrypted storage in the same country plus a second copy elsewhere the client approves; keep at least 7 daily
      and 4 weekly.
- [ ] **Files.** Database backups do not include Storage objects (verify for your host). Copy the nine buckets on a
      schedule (hosted: through the S3-compatible Storage endpoint with `rclone` or the AWS CLI; self-hosted: snapshot
      the storage volume). Private buckets matter most: `wfm`, `quote-attachments`, `order-attachments`,
      `inbox-attachments`, `deal-room-files`, `tender-boq-files`.
- [ ] **Keys.** `FIELD_ENCRYPTION_KEY` and `QUOTE_PUBLIC_LINK_SECRET` are escrowed (password manager, plus a sealed
      copy held by the client's nominated officer if the contract says so). Without `FIELD_ENCRYPTION_KEY` the
      encrypted fields in a restored database are unreadable.

### Restore test (before go-live, then quarterly)

1. [ ] Restore the latest database backup into a **scratch** project (never over the live one).
2. [ ] Restore the matching files into its buckets.
3. [ ] Point a scratch Vercel deployment (or local `next start`) at it with the real `FIELD_ENCRYPTION_KEY`.
4. [ ] Check: login works; an account opens and its phone/e-mail decrypt; a quote PDF opens; a BOQ file downloads.
5. [ ] Record the date, the time it took, and who did it, in the ledger. Delete the scratch project.

### Monitoring

- [ ] Uptime check on `https://<client-domain>/login` (every minute) alerting two people.
- [ ] Vercel: runtime error alerts for the project; review the Logs for `[encryption] FIELD_ENCRYPTION_KEY is not set`,
      `RESEND_API_KEY is not set`, `[resend webhook] ... refused` and any cron returning non-2xx.
- [ ] Vercel Cron Jobs page: last-run status of the 21 jobs weekly.
- [ ] Supabase: database CPU, connections, disk (self-hosted: disk is the thing that fills up; alert at 70 percent),
      Auth error rate, Storage size.
- [ ] Resend: bounce and complaint rates (the app records delivery events when `RESEND_WEBHOOK_SECRET` is set).
- [ ] Certificate expiry and domain renewal dates in a shared calendar.
- [ ] Anthropic / AWS spend alerts if those services are on.

### Rollback plan

| Situation | Action |
|---|---|
| Bad deployment | Vercel > Deployments > previous good one > Instant Rollback. **A rollback pins production**; later pushes build but are not promoted until you promote explicitly (`DEPLOYMENT_GUIDELINES.md`). |
| A migration failed | Each migration runs with `-1`: nothing partial. Fix and re-run; do not edit applied history. |
| A migration succeeded but is wrong | Restore the pre-migration backup into a scratch project, confirm, and either restore over the live database (downtime, owner and client informed) or write a corrective forward migration (usually better). |
| Release needs SQL that cannot be undone | Roll the code back **only** if it still works with the new schema; the repo's migrations are additive and the app tolerates extra columns. If not, restore. |
| Compromised key | Rotate `SUPABASE_SERVICE_ROLE_KEY` (and JWT secret if the anon key too), redeploy with new values; rotate `CRON_SECRET`, `QUOTE_PUBLIC_LINK_SECRET` (this invalidates issued public links), webhook secrets; **`FIELD_ENCRYPTION_KEY` cannot be rotated without a re-encryption tool that does not exist**: treat its leak as a data incident and escalate to the owner. |
| Instance must be taken down | Set the tenant `status` to `suspended` in `/admin/tenants/<id>`, or pause the Vercel project; export per `src/lib/tenantExport.ts` / backups before deleting anything. |

---

## 14. Smoke tests (run after step 10, and the short form after every release)

Use the tenant admin login on the client domain. Keep **Email output = redirect** until step 9 passes.

1. [ ] **Login.** `/login` accepts the tenant admin; forced password change appears the first time; after it, the
       dashboard loads. A wrong password shows an error and does not loop. Sign out and in again.
2. [ ] **Tenant scoping.** The nav shows only the sold modules; Settings has no cards for absent modules
       (`TENANT_PROVISIONING.md` section 3).
3. [ ] **Invite path.** Settings > People > invite a second user with an initial password; they can sign in. Then
       invite one without a password: the invite e-mail arrives (this proves SMTP and that disabling signups does not
       block admin invites). Request "forgot password" for the second user: the reset e-mail arrives (proves Resend).
4. [ ] **Create the tenant through the studio** (already done at step 10; for a re-test use a throwaway slug and
       delete it afterwards in `/admin/tenants`).
5. [ ] **Create a tender deal.** Pipeline > Tenders tab (needs `gcc_tender`) > new tender with number, issuer, closing
       date. It appears on the Tenders board and shows the closing-date chip.
6. [ ] **Upload a BOQ.** On the tender, upload a small client BOQ Excel (bucket `tender-boq-files`); the lines appear.
       Download the priced Excel back. Then post a message and attach a file in the **Deal Room** (needs `deal_room`;
       bucket `deal-room-files`) and see it from a second user.
7. [ ] **Cron route returns 401 without the secret, 200 with it.**
       ```bash
       curl -s -o /dev/null -w "%{http_code}\n" https://<client-domain>/api/tenders/cron/reminders          # expect 401
       curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CRON_SECRET" \
            https://<client-domain>/api/tenders/cron/reminders                                              # expect 200
       ```
       Repeat for `/api/middleware/cron/prune`. A 307 to `/login` instead of 401 means the proxy gate swallowed the
       route: report it as a defect (the prefix list is in `src/proxy.ts`).
8. [ ] **File upload to each private bucket**, through the product, then open the file back:
       `wfm` (an employee enrolment photo, if WFM is on), `quote-attachments` (a standard quote attachment),
       `order-attachments` (a sales order attachment), `inbox-attachments` (an inbox attachment or forwarded mail),
       `deal-room-files` and `tender-boq-files` (step 6). For the public buckets: upload a tenant logo
       (`company-assets` / `logos`) and add a photo to a service case (`case-photos`) and confirm each URL opens
       without login. In Storage, confirm the six private buckets refuse an anonymous URL.
9. [ ] **E-mail goes through `resolveOutbound`.** With Email output = redirect to the controlled inbox, send a quote
       (or a tender reminder / invoice) to a customer contact. The mail arrives **only** in the controlled inbox, with
       the intended recipient named in the subject/body, and a row appears in Administration > Outbound Emails. Then
       switch to partners mode, send one to a test address you own, and confirm the From domain is
       `RESEND_SENDING_DOMAIN`, not `bpmsquare.com`.
10. [ ] **Isolation sanity.** Sign in as the second (non-admin) user and confirm `tenants.api_key` is not readable:
        in the browser console, `await (await fetch('<supabase-url>/rest/v1/tenants?select=api_key', {headers:{apikey:'<anon-key>', Authorization:'Bearer <user-jwt>'}})).status` must not return the key (expect an error status). (This is the check migration 0200 exists for.)
11. [ ] **PII encryption on.** Create an account with a phone number; in the Supabase table editor the stored `phone`
        value is ciphertext, not the number (proves `FIELD_ENCRYPTION_KEY` is set on the deployment).
12. [ ] **PDF.** Open a quote PDF (proves the bundled Chromium and `VERCEL` handling work in the chosen region).
13. [ ] **Logs.** Vercel logs show no `FIELD_ENCRYPTION_KEY is not set`, no 500s on the steps above.

Record the date and results in the ledger.

---

## 15. Cost and operations note (no prices; fill in from current vendor quotes)

What the instance costs to run:

| Line | Notes |
|---|---|
| Supabase hosted project | one paid project for this client; add-ons for point-in-time recovery, larger compute, extra storage as needed |
| **or** self-hosted | one or more cloud servers in the chosen country, block storage, a snapshot / backup store, a load balancer or reverse proxy with TLS, plus **operator time** for patching, upgrades, and incident response; no vendor support unless purchased |
| Vercel project | a team plan that allows the cron frequency and function memory used; bandwidth and function usage grow with the client |
| Resend | a plan sized to the client's e-mail volume and sending domain |
| Anthropic API | usage-based; only if D3 is yes |
| AWS Rekognition | per image, only for face punch |
| Domain and DNS | the client's domain, or ours |
| Monitoring and password manager | uptime service, log retention |

What it costs to maintain (the recurring part the pricing must cover; `TENANT_PROVISIONING.md` calls this the
Enterprise tier):

- **Every release**: run new migrations here, merge `main` into `instance/<slug>`, smoke test, update the ledger
  (section 12). Budget a fixed amount of operator time per release, plus the backup beforehand.
- **Quarterly**: restore test, key and access review, certificate and domain checks, dependency and Supabase / Postgres
  version review (self-hosted: this is a real upgrade project each time).
- **On call**: name one primary and one secondary person for this instance, with the client's escalation contact. The
  system has no automatic failover: a Vercel or database outage is a manual response. Agree support hours and the
  response target in the contract before go-live; the kit does not provide a service level.
- **Not included by the kit**: Arabic / right-to-left interface, ZATCA submission, WhatsApp provider, a Gulf-resident
  AI or e-mail option. Each is a scoped piece of work.

---

## 16. Known defects and gaps this work found (for the owner)

1. `case-photos` bucket missing from every migration (fixed for new instances by `bootstrap.sql`; add it to a
   migration when convenient so production and new instances match by construction).
2. The baseline inserts the owner's e-mail as platform admin and a `vikas` tenant; a fresh database must not carry
   them (handled by the builder; a cleaner fix is to move those two inserts out of `0000_baseline.sql` into a
   production-only file).
3. `service_cases.created_at`, `work_orders.created_at`, `assets.created_at` are read by code and added by no
   migration; check production (`dump-prod-schema.md`, section 6).
4. `RESEND_SENDING_DOMAIN` defaults to `bpmsquare.com` in 16 senders and `VAPID_SUBJECT` to
   `support@bpmsquare.com`; harmless on the shared platform, wrong on a dedicated instance if forgotten.
5. `vercel.json` pins `icn1` (Seoul) for every project built from the file.
6. `FIELD_ENCRYPTION_KEY` has no rotation tool.
7. `PROJECT.md` says no Supabase-GitHub integration applies migrations; `RELEASE_PROCESS.md` describes one for staging.
   Do not rely on either for a dedicated instance: this runbook applies migrations by hand with `psql`.
8. `src/app/api/auth/dev-signin/route.ts` contains the owner's e-mail address; it returns 404 when `NODE_ENV` is
   `production` (always on Vercel), and `bpmsquarecore` notes it should be deleted.

---

## 17. Questions for Supabase (ready to paste into an e-mail)

> Subject: Gulf data residency for a Supabase-backed enterprise application
>
> Hello,
>
> We run a multi-tenant business application on Supabase (Postgres, Auth, Storage, Realtime; no Edge Functions) and a
> prospective enterprise customer requires its data to stay in the Gulf (UAE or Bahrain; Saudi Arabia is a second
> choice). We see no Middle East region in your published list. Could you tell us:
>
> 1. Is there a Supabase region in the UAE or Bahrain today, in preview, or on the roadmap? If on the roadmap, what is
>    the expected date and which of the two?
> 2. If not, does Enterprise offer a dedicated or bring-your-own-cloud deployment (Supabase-operated, in our AWS
>    account or yours) in `me-central-1` (UAE) or `me-south-1` (Bahrain)? What are the lead time and the minimum commitment?
> 3. Pricing: the structure and indicative figures for (a) a Gulf-region project, (b) a dedicated / BYO-cloud
>    deployment, including support, backups with point-in-time recovery, and egress.
> 4. Do you sign a Data Processing Agreement and provide sub-processor lists, and do you commit contractually to data
>    location and to no cross-region replication or support access from outside the region? What certifications can you
>    share (SOC 2, ISO 27001, others)?
> 5. Is self-hosting the open-source stack in a customer's own cloud account supported commercially (a support
>    contract, SLAs, upgrade guidance, security advisories)? If yes, is there a recommended production architecture
>    beyond the Docker Compose reference?
> 6. For a hosted project in the nearest region, what do backups include (database only, or Storage objects as well),
>    what are the point-in-time recovery windows, and can backups be exported to storage in a region we choose?
> 7. Are there restrictions we should know about in a dedicated or self-hosted setup (Realtime, Storage S3 API, Auth
>    features, Studio) compared with the hosted product?
> 8. Who is the right contact for an Enterprise conversation, and what is your typical timeline from first call to a
>    running environment?
>
> Thank you.
