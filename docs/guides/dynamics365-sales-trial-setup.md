# Dynamics 365 Sales trial: sign-in problem and environment set-up

Written 2026-10-21 while doing it. Steps are added as they are done.

## Symptom
Subscribed to the Microsoft trial of Dynamics 365 Sales. Clicking "Anmelden" on
the Dynamics 365 marketing page opens the Microsoft 365 "Apps" page, which lists
Word, Excel, Power Platform apps and no Dynamics 365 Sales.

## Diagnosis (three checks, all read-only)
1. **Is the sign-in working?** Yes. The Apps page at
   `https://m365.cloud.microsoft/apps` shows the work account as signed in.
   The marketing page never opens the CRM; it only signs in to Microsoft 365.
2. **Is there a licence?** `https://admin.cloud.microsoft/#/licenses` lists
   "Dynamics 365 Sales Premium", 25 licences, 1 assigned.
3. **Is there an environment to open?** Power Platform admin centre,
   `https://admin.powerplatform.microsoft.com/manage/environments`, shows
   "0 environments". Dynamics 365 Sales runs inside an environment with
   Dataverse, so with none there is nothing to open.

Conclusion: login is fine, the trial was never provisioned into an environment.

## Fix
Create an environment with Dynamics 365 apps enabled (steps below).

### Steps done
1. Power Platform admin centre, Environments, **New**. The form opens on the right
   with Type, Macro Region Geography and Name. (Opening the page also made
   Microsoft create the tenant's *default* environment, "ServiceSphere UG
   (default)", with Dataverse "No". That one is not used for Sales.)
2. Region choices offered: North America, The Americas, European Union & EFTA,
   Europe & UK, Europe/UK/Middle East/Africa, Asia Pacific.

### What was chosen, and why
- **Region:** European Union & EFTA (owner: keep it in Europe/Germany). The
  region is fixed after save. Microsoft picks the exact country by capacity;
  the tenant's default environment landed in Switzerland, so check the
  environment's "Region" column afterwards if Germany specifically matters.
- **Language / currency:** English (United States), EUR. Currency is fixed
  after save.
- **Security group:** None (open to the tenant). Fine for a single-user trial;
  restrict it before real users are added.

### First attempt failed: type Sandbox
Type Sandbox with Dataverse on, Dynamics 365 apps on and "Sales Enterprise"
selected ended with: *"Trial licenses are limited to being able to only create
Trial environments. There is not enough capacity to create a new environment."*
A trial licence carries no Dataverse capacity, so only the Trial types work.

### Second attempt that worked
1. Environments, **New**.
2. **Type: Trial (subscription-based)**, Macro region European Union & EFTA,
   Name **Sales Trial**, **Next**. (The plain "Trial" type is a 30-day
   throwaway; the subscription-based one lives as long as the licence trial.)
3. Language English (United States), currency EUR, Security group **None**.
4. **Enable Dynamics 365 apps: Yes.** This cannot be undone for the
   environment. Without it the Sales app cannot be installed later.
5. **Automatically deploy these apps: Sales Premium Trial.** (With Sandbox the
   list offered Sales Enterprise instead; the list depends on the type.)
6. **Save.** Banner: "New environment Sales Trial is preparing."

Gotchas met on the way: pressing Esc inside the app dropdown closes the whole
side panel and loses the form; switching Type resets the Dataverse toggles, so
re-set them after changing it.

### Result (verified 2026-10-21)
- Environment **Sales Trial**: State Ready, Dataverse Yes, type Trial
  (subscription-based), created 16:28, the create operation took about 10 s.
- **Sign-in link:** `https://orgd0307406.crm17.dynamics.com`. At the
  "Pick an account" step choose the `...@ServiceSphereUG.onmicrosoft.com` work
  account (the one that holds the licence), not the personal-domain account.
- That opens the Dynamics 365 app list (13 apps). **Sales Hub** opened and
  shows sample data (work list, accounts). Sales trial and Sales Team Member
  apps are installed too.
- Saved as a browser bookmark, this URL is the front door. The
  `dynamics.com` marketing page's "Anmelden" only ever led to the Microsoft 365
  apps page, which is why the CRM looked missing.

### Things to know
- **Region is Switzerland, not Germany.** "European Union & EFTA" includes
  Switzerland, and Microsoft picks the country by capacity (the tenant's
  default environment is also Switzerland). Data stays in the EU/EFTA area
  (crm17 is the Swiss datacentre). If Germany specifically is required, a
  new environment under "Europe & UK" or a support request is the route.
- Security group is None: every user in the tenant can be given access.
- A trial environment ends with the trial licence. Back up anything needed.
- The default environment "ServiceSphere UG (default)" has no Dataverse and
  is unused.

## Finance and Operations trial: checked, not yet subscribed
Checked 2026-10-21 for an existing Finance and Operations demo:
- Power Platform admin centre: 2 environments (Sales Trial, default). None for F&O.
- Microsoft 365 admin centre, Licenses: only Dynamics 365 Sales Premium.
- Lifecycle Services (`lcs.dynamics.com`): sign-in page only, nothing checked inside.

Where the trial is: Microsoft 365 admin centre, Marketplace, All Products,
search "Dynamics 365 Finance", **Dynamics 365 Finance Premium**, plan
"Dynamics 365 Finance Premium (Trial)", free for 1 month, 25 licences,
21 Oct to 20 Nov 2026, Total due EUR 0.00.

**Decision (owner, 2026-10-21): trial only, cancel right after the integration
test.** Ordered 2026-10-21 with the smallest renewal as a safety net.

### Ordered
1. Marketplace, **Dynamics 365 Finance Premium (Trial)**, 25 licences, Start
   free trial. Billing account ServiceSphere UG (MCA).
2. Checkout step 1: total due EUR 0.00, trial runs 21 Oct to 20 Nov 2026.
3. Checkout step 2, *Trial renewal settings*: set **1 licence, 1 month**
   (default was 1 year, pay yearly). If left alone the paid subscription
   starts **21 Nov 2026** at EUR 311.88 plus tax (EUR 371.14).
4. Place order. Confirmation: "You've added Dynamics 365 Finance Premium
   (Trial)... renewal settings can be changed at any time before your trial
   expires on November 20, 2026." Invoice (EUR 0) emailed within 24 hours.
5. Licenses page now lists Finance Premium, 25 available, 0 assigned.

### MUST DO: cancel after the integration test
Microsoft 365 admin centre, Billing, Your products, Dynamics 365 Finance
Premium (Trial), Cancel subscription or turn off the renewal. Do it before
20 Nov 2026. Refunds are only prorated within 7 days of a paid purchase.

### Still to do for a Finance and Operations test
- Assign a Finance Premium licence to the test user (0 of 25 assigned).
- Provision the Finance environment (hours, not minutes) in the Power
  Platform admin centre.
- Entra app registration plus application user; connect in BPMSquare.

## Integration test with BPMSquare (started 2026-10-21)

### Done
- **Finance Premium licence assigned** to the test user (admin centre,
  Licenses, Dynamics 365 Finance Premium, Assign licenses, user picked,
  Assign). Count went 0 to 1 of 25.

### What the connector needs from Microsoft
Login type **OAuth 2.0 app registration + client secret** (client
credentials), because "sign in as a user" also requires a client secret or
certificate in the code (`exchangeAuthCode` / `clientAuth`). So three values:
Directory (tenant) ID, Application (client) ID, client secret, plus an
**application user** for the app in the Dataverse environment.

### Blocked here: Microsoft asks for multi-factor set-up
Opening the Entra admin centre (`entra.microsoft.com`) to register the app
showed "Let's keep your account secure" and wants the Microsoft Authenticator
app on a phone. That is the account owner's security set-up and is done by
the owner, not by the assistant. Steps after that are listed below.

### Next steps (after the owner finishes the Authenticator set-up)
1. Entra, App registrations, **New registration**: name "BPMSquare connector
   test", single tenant, no redirect URI. Note the two IDs.
2. Certificates & secrets, **New client secret**. The value is shown once.
   The owner copies it and pastes it into the BPMSquare connector screen
   himself; it is never typed or repeated by the assistant.
3. Power Platform admin centre, Sales Trial, Settings, Users + permissions,
   **Application users**, New app user: pick the app, business unit, role
   (System Administrator for this throw-away trial only).
4. BPMSquare, Settings, Connectors, Microsoft Dynamics 365: product
   **Dataverse**, login type client secret, environment
   `https://orgd0307406.crm17.dynamics.com`, directory ID, client ID, secret.
   **Test connection**, then **Preview** per entity.
5. **Dynamics to BPMSquare (pull):** Sync now for customers (accounts),
   contacts and products. Check counts and the rows in BPMSquare.
6. **BPMSquare to Dynamics (push):** the connector's push is for won fence
   projects and defaults to `msdyn_projects` (Project Operations, not in
   Sales). It is configurable: set the target entity to `opportunities`,
   id field `opportunityid`, fields `name={name}`,
   `description={ref} · {summary}`, and the customer bind
   `customerid_account@odata.bind=/accounts({account_external_id})`.
   Win a demo fence project, **Push won projects**, then look for the
   Opportunity in Sales Hub.
7. Record counts, screenshots and any errors here.

### Progress log, 2026-10-21 (continued)
- Owner finished the Microsoft Authenticator set-up (needed for the Entra
  portal). Entra opened.
- **App registration created:** "BPMSquare connector test", single tenant, no
  redirect URI. Application (client) ID `17b981d7-4497-44da-a81a-dab8df10a953`,
  directory (tenant) ID `27ce54ea-c043-44b0-b414-f9ffb8d978fb` (identifiers, not
  secrets).
- **Client secret created** ("BPMSquare integration test", expires 19 Apr 2027).
  Its value is not recorded anywhere. Delete the secret and the app
  registration after the test (Entra, App registrations, the app, Delete).
- **Application user added** in Sales Trial: Power Platform admin centre,
  Environments, Sales Trial, Details, Access, S2S apps, New app user. App =
  the registration, business unit = the root unit, security role = System
  Administrator (trial only; use a narrower role on a real tenant).
  Message: "has been successfully added to this environment".
- **BPMSquare demo workspace** (`app.bpmsquare.com`, Settings, Connectors,
  Microsoft Dynamics 365): product Dataverse, login type client secret,
  environment URL, directory ID and client ID filled in. **Client secret left
  blank for the owner to paste** (the assistant does not type secrets), then
  Save, Test connection.

### Blocker 1: Save failed on app.bpmsquare.com
After pasting the secret and clicking Save the screen showed: *Could not find
the table 'public.tenant_connectors' in the schema cache.* The database
behind this workspace never got the connector migrations (the same gap
that stopped security bundle 8 earlier, which is why its connectors block was
written to skip a missing table).

Fix, run by the owner in the Supabase SQL editor of that database:
`scripts/run-bundle-9-connectors-2026-10-21.sql` = 0049 (tenant_connectors),
0129 (connector_links, connector_sync_runs), 0136 (one running sync per
entity), then the tenant_connectors block of 0199 so credentials are
admin-write only (without it 0049 leaves a policy any member can write
through). It ends with `notify pgrst, 'reload schema'`. Safe to run twice.
Then click Save again on the open page (the secret is still in the field).

### Result: connector connected (2026-10-21, 17:2x)
After bundle 9 and Save: banner "Connected to Dataverse — signed in as user …
in organisation cf598c71-…", status **Connected**, secret shown as "Stored"
and never displayed again. Used: product Dataverse, login type OAuth 2.0 app
registration + client secret, `https://orgd0307406.crm17.dynamics.com`.

### Dynamics to BPMSquare (pull), run on the demo workspace
Preview first (shows the real Dataverse columns and 5 sample rows: Fabrikam,
Trey Research, Northwind Traders, Alpine Ski House, A. Datum), then Sync now:

| Entity | Read | Created | Updated | Failed |
|---|---|---|---|---|
| Customers to Accounts | 6 | 6 | 0 | 0 |
| Contacts to Contacts | 12 | 12 | 0 | 0 |
| Products to Products | 9 | 9 | 0 | 0 |

Checked in BPMSquare: Accounts list now 108 total, including *A. Datum
Corporation* (ACC-0103, Redmond, 1 contact) and *Alpine Ski House* (ACC-0102,
Dallas, 2 contacts): new business refs, contacts linked to their accounts.
Where to see it: Settings, Connectors, Microsoft Dynamics 365, the result line
under each entity and the **Recent runs** table at the bottom.

### BPMSquare to Dynamics (push), run on the demo workspace
1. **Test data:** a new fence project **FNC-0002** for *A. Datum Corporation*
   (an account that itself came from Dynamics, so the connector knows its
   Dynamics id). Fence Projects, New, "Skip, start blank", Account =
   A. Datum Corporation, Save. Renamed "A. Datum perimeter fence (Dynamics
   push test)".
2. **Won:** nothing on the screen marks a fence project as won, and no code
   path sets it (finding below). It was set through the app's own save route
   (`PATCH /api/fence-projects/{id}` with `status: won`) from the signed-in
   admin's browser.
3. **Push target changed:** the default target is `msdyn_projects` (Project
   Operations), which Sales does not have. In Settings, Connectors, Dynamics
   365, "Fence projects to Projects (push)", Map: Entity set `opportunities`,
   ID field `opportunityid`, field map:
   ```
   name = {name}
   description = {ref} · {summary}
   customerid_account@odata.bind = /accounts({account_external_id})
   ```
   Tick the row, Save ("Saved. Press Test connection to check it."),
   **Push won projects**.
4. **Result:** row shows "opportunities · 1 linked". Run history: push,
   fence_projects, succeeded, read 1, created 1, failed 0.
5. **Verified in Dynamics** (Sales Hub, Web API query on opportunities): one
   new Opportunity, name "A. Datum perimeter fence (Dynamics push test)",
   customer **A. Datum Corporation**, description "FNC-0002 · Closed
   perimeter, 500 m", created 2026-10-21 15:33 UTC.

### Findings
- **Both directions work** against Dynamics 365 Sales (Dataverse): pull of
  accounts, contacts, products; push of a won fence project.
- **Account links hold across directions:** the Opportunity was attached to the
  right Dynamics account because the account arrived by pull earlier. A project
  for an account that was never synced is sent without a customer.
- **No way to mark a fence project won in the product.** The connector pushes
  only status "won", the screen has no control for it, and nothing sets it
  (the quote flow does not). Needs an owner decision: a status control on the
  fence project, or setting it when its quote is won.
- **The push default targets Project Operations.** A Sales-only customer must
  re-point it (as above). A preset per Dynamics product would avoid that.
- **Push is once only:** the link row stops a second push of the same project.
- **Production database lacked the connector tables** (0049, 0129, 0136); fixed
  by bundle 9. Same gap that made 0199's connectors block need a guard.
- **Products list_price** mapped from Dataverse `price` and arrived with 9
  products; contacts arrived with their accounts attached.
- Not tested: Finance and Operations (no environment yet), automatic hourly
  sync, "Full resync", updates flowing on a second pull.

### Test data and cleanup (owner decision 2026-10-21: keep it, it is our trial tenant)
Nothing in the trial tenant is deleted unless the owner says so. Kept as is:
the Opportunity "A. Datum perimeter fence (Dynamics push test)", the synced
sample accounts, contacts and products, FNC-0002, the Entra app registration
and its client secret, the application user, the connector connection.
(Two scratch quotes "ZZ test quote A/B" created to prove the Dataverse quote
lifecycle were deleted by mistake before this decision; they are recreated by
the build tests.) Still time-bound: the Finance Premium trial renews on
21 Nov 2026 (EUR 371.14 incl. tax) unless cancelled before 20 Nov; the client
secret expires 19 Apr 2027; the Sales trial ends with its licence.

## Topics needing enhancement or design decisions (2026-10-21)
**Connector behaviour**
1. Fence project won: no control in the product sets it; decide the trigger (button, or when its quote is won).
2. Push target per Dynamics product: preset for Sales (Opportunity), Project Operations (project), F&O (project) instead of one Project Operations default.
3. Sales push semantics: Opportunity is created Open with no value or close date; close it as won, or create a sales order, or keep as open deal.
4. Push covers only won fence projects; decide whether accounts, contacts, products, won quotes and estimates go out too (ERP plan, "DocumentWon").
5. Untested: second pull (updates), full resync, automatic hourly sync, deletes in Dynamics, Finance and Operations.
6. Preview shows raw Dataverse columns including internal ids; show mapped fields first and hide empty and system columns.
7. Recent runs table did not show the push run until the data was re-read; refresh it after a push.

**Identity and visibility**
8. Dynamics ids not shown on records; add an "External record" line (name, readable number, Open in Dynamics link) on synced records.
9. Readable keys: Opportunities have none; write the BPMSquare ref (FNC-0002) into a visible Dynamics field and store whatever readable key comes back.
10. Contacts and products readable keys and the same line on them.

**Operations and security**
11. Message monitor (docs/design/message-monitor.md): scope, payload capture, access.
12. Application user is System Administrator for the test; define a least-privilege Dynamics role per entity.
13. Client secret expires (180 days); warn before expiry, support certificate login.
14. Production database lacked connector tables; add a schema-health check that lists pending migrations before a feature is used.
15. Region: environment landed in Switzerland, not Germany; decide residency per client and document how to choose it.
16. Finance trial and the Sales trial end; plan the permanent test environments and the cancel dates.

## Reminder to cancel both trials (set 2026-10-21)
One reminder for both the Sales Premium and the Finance Premium trial, **13 Nov
2026, 10:00** (7 days before the Finance trial ends on 20 Nov), in the owner's
own calendar (pop-up at the time, email 1 hour before). It lists where to
cancel: Microsoft 365 admin center, Billing, Your products. The exact Sales
trial end date is not shown in the admin center; check it there on the day.
If testing finishes earlier, cancel right then.

## Live test of the Integration middleware (2026-10-21, demo workspace, build fdf214ba)
Bundle 10 was run on dev and production, which switched the flag on for the demo workspace.

| Step | Result |
|---|---|
| Open Settings, Integrations, Integration middleware | Page opens; connector chip Dynamics 365, set-up guide, five tabs |
| Connections: live price list and currency lists, database health | Lists loaded from Dynamics (Contoso Coffee Price List, Euro); all four tables present |
| Save price list and currency | Saved (see finding 4) |
| What goes out: Send a test quote | Created ZZ-TEST-202610211820 as **QUO-01004-G0H0M6**, state Won, 2 lines, total 25, price list Contoso Coffee |
| Real path: Standard Quote SQ-2026-0017 (A. Datum, 3 lines, 18,960) draft, Mark as sent, **Mark accepted** | Within seconds Dynamics has **QUO-01005-B5Y9D3**: name "SQ-2026-0017 · A. Datum Corporation", customer A. Datum Corporation, 3 lines (12,250 + 5,010 + 1,700), total 18,960 = BPMSquare, state Won, description ends with the BPMSquare marker |
| ERP id on the quote page | "Dynamics 365 · QUO-01005-B5Y9D3 · Open in Dynamics" |
| Send now four times, two in parallel | Every answer "Already in the ERP as QUO-01005-B5Y9D3. Nothing was sent twice." No twin |
| Rejected path: SQ-2026-0018 (2 lines, 3,700), sent, **rejected** | Dynamics has **QUO-01006-S5J5V5**, state Closed, status Lost, 2 lines, marker present |
| Monitor | Lists the two awarded sends, the earlier fence push and the three pulls (accounts, contacts, products) |
| Mapping metadata | 95 Dynamics quote fields and 68 quote-line fields fetched with required marks; "Using the standard mapping" true for quote, line and project |

### Findings from the test
1. **Check permissions is wrong:** it says "Create quotes" and "Mark quotes won or lost" are not allowed, yet both just worked. Fix the privilege lookup or show "unknown, use Send a test quote".
2. **ID line wording on a legacy link:** FNC-0002 (pushed earlier as an Opportunity, which has no readable number) shows "Dynamics 365 · FNC-0002", i.e. BPMSquare's own ref under the Dynamics name. Show the Dynamics record's name or entity ("Opportunity") instead.
3. **Fence quote cannot be priced on this demo:** "Continue to quote" on FNC-0002 reports 12 lines with no cost source (demo pricing data), and left an empty draft SQ-2026-0017 behind. Not a middleware fault.
4. **Two quick changes lose one:** choosing a price list and a currency within the same instant saved only the price list. Selecting them one after the other works. Stale-state handling in the Connections form.
5. **Set-up "What goes out" tick** is on as soon as a rule exists (rules default on).
6. **Send a record for an account** still uses the old webhook push; there is no create-account-in-Dynamics step.
7. **Not yet checked in a browser:** Mapping tab editing, Monitor panel and filters, Resync tab, phone width on the live data.
