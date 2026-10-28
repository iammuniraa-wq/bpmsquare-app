# Instance ledger: KAMCO (dedicated)

No secrets in this file. Runbook: `docs/dedicated-instance.md`.

| Field | Value |
|---|---|
| Decision D1 (database) | Supabase hosted, Frankfurt `eu-central-1` (KAMCO confirmed Europe hosting, 2026-10-26) |
| Decision D2 (app region) | Vercel `fra1` (set in `vercel.json` on this branch) |
| Decision D3 (AI) | On from day one (owner's choice 2026-10-26; **needs KAMCO's written OK**: prompts leave Europe to Anthropic) |
| Decision D4 (e-mail) | Resend, KAMCO sending domain (to confirm) |
| Vercel project / branch | `bpmsquare-kamco` / `instance/kamco` (= main plus the one-line region change) |
| Built from commit | 4a9992a1 |
| Fresh schema | 175 files, -- overall-sha256 (source files, in order): 0297ff75524dae49d5e69fb60972f79f934bc268f1c7293b9d8b3d6ec1353f60 -- body-sha256 (everything below the first "-- ===== BEGIN" line, as shipped): ab6495103d584739a8cee0a6635620b65d59f98e873a142b90fff6425d62dd77  |
| Highest migration applied | 0227_estimates_in_tender (not applied yet) |
| Applied after the fresh build | none |
| Pending | everything: the instance is not created yet |
| Last restore test | not done |
| Status | **Steps 2 onward not started: Supabase project to be created by the owner** |
