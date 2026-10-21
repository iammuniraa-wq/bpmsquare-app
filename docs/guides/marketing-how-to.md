# BPMSquare Marketing: How to set up and run it

Snapshot 2026-10-21

> Screen names and button words may be refined as we improve the product. If a name in this guide is slightly different on your screen, look for the same idea nearby.

This guide is for the marketing or sales manager. You do not need to be technical. Each chapter has the same five parts: what it is for, how to set it up once, what to do day to day, what the colours and labels mean, and what to do if something looks wrong.

**Chapters**

1. Consent and topics
2. Forms and the preference centre
3. Newsletter Studio
4. Email health
5. Scored leads
6. Journeys
7. Buying signals
8. ABM programs
9. Process Design Studio
10. A day in the life
11. Glossary
12. Getting help

---

## Before you start

### Who switches these modules on

The BPMSquare team switches each marketing module on for your workspace. You cannot do it yourself, and nobody else in your company can. Once it is on, your administrator sees it in the menu under **Marketing** (and under **Settings → Marketing**).

If you do not see a menu item this guide talks about, it is not switched on yet. Ask us. Nothing is lost while you wait.

Some screens also need a one-time database update that we run for you. Until it is done, the screen says "waiting for a database update". That is normal. Nothing is broken and nothing is lost.

### The golden rules

1. **Consent first.** Nobody is emailed until they have said yes, unless you chose otherwise. Every send checks this again at the moment of sending. The product will not let you skip it.
2. **Start small.** Your first send goes to a handful of colleagues, not to all your customers. Your first journey goes to one person.
3. **Use "Try it" first.** Journeys has **Try it on one person**. Newsletters have **See it as this person** and **Check the audience**. None of them sends anything.
4. **Check Content health.** Before you send a newsletter, fix every amber item.
5. **English is the default language.** Write in English first. Add Arabic (or another language) on top, and review it.
6. **You can always pause.** A journey has a **Pause** button. Pausing stops all sending at once.

### Small things worth knowing

- A little **i** icon beside a setting is being added in many places. Tap the **i** for an explanation.
- Many screens have a **Show me how** button. It is a short walkthrough. It never starts by itself and you can skip it at any step.
- Anything marked **Coming later** is not built yet. We do not promise it.

---

## 1. Consent and topics

### What it is for

Consent is a person's "yes, you may contact me about this." BPMSquare keeps every yes and every no as a record, with the date and how it was given. A new answer never erases an old one. Every newsletter, journey and campaign checks this record before it sends.

A **topic** is a subject people can agree to separately, for example "Offers" or "Newsletter". Someone can say yes to one topic and no to another.

### Set it up (once)

Open **Settings → Marketing → Consent and topics**. You need to be an administrator.

1. **Topics.** Check the list. Rename a topic or write a one-line description of what it covers. Choose **+ Add a topic** if you need another. A topic people have already answered can be renamed but not removed.
2. **When nobody has said yes.** For each country group, choose one of:

| Choice | What it means | Safe default? |
|---|---|---|
| Only people who have said yes | Nobody without a recorded yes is emailed | **Yes. Keep this.** |
| Also existing customers, about similar products | A customer who never said yes can still hear about similar products | Only if your legal adviser confirms it |

3. Press **Save**.

Ask your legal adviser before you change the default. The rule in each country is different. For Saudi Arabia, the screen explains that marketing needs the person's opt-in.

### Do it day to day

**Record a yes or a no you got another way** (for example on a phone call):

1. Open **Contacts** and open the person.
2. Go to the **Marketing** tab and find the **Consent** card.
3. Press **Record consent** or **Record withdrawal**.
4. Pick the channel (Email, WhatsApp, SMS, Phone calls) and the topic, or leave it on **All topics**.
5. For a yes, pick **Basis**: **They agreed** is the safe choice. **Existing customer** appears only where your country and settings allow it.
6. In **How you got it**, write a sentence, for example "Agreed by phone on 20 Oct". This is required.
7. Press **Save consent** or **Save withdrawal**. Nothing is sent to the person.

**Bring in a list of people who already agreed:**

1. Open **Data Workbench** and choose **Import**, then **Consents**.
2. Your file needs one row per answer. These are the columns:

| Column | What to put |
|---|---|
| Email | The contact's email. The person must already be a contact. |
| Channel | email, whatsapp, sms or phone. Blank means email. |
| Topic | One of your topic names. Blank means every topic. |
| Answer | `granted` if they agreed, `withdrawn` if they asked to stop |
| Basis | For every granted row: `consent` or `existing_customer` |
| Date they agreed | Optional. Kept as evidence. |
| Note | Optional. How you got it, for example "Trade show card". |

3. Download the sample file from the screen if you want a model.

An import never creates a contact and never edits an old answer. Rows it cannot match are listed as skipped. An email shared by two contacts is refused.

You can also **Export** the current answers from the same place.

### What the colours and labels mean

| Label | Meaning |
|---|---|
| Agreed (green) | They said yes for this channel and topic |
| Withdrawn (red) | They said no, or asked to stop |
| They agreed | The safe basis: the person told you they are happy to hear from you |
| Existing customer | They already buy from you and may hear about similar products |
| How we know | A person, a form, their preferences page, an unsubscribe link, a file import, or the email service |

### What a withdrawal does

- The person is left out of every future send for that topic (or all topics).
- It is kept as history. Nothing is deleted.
- If someone chose **Unsubscribe from all**, only they can come back. They ask you, and you record their consent on the contact.
- A person marked **do not contact**, or who used the old unsubscribe link, cannot switch topics back on from a link. They are told to get in touch with you.

### If something looks wrong

| You see | What to do |
|---|---|
| A person is left out and you think they said yes | Open their **Consent** card. If no yes is recorded, record it with a note on how you got it. |
| The Consent card says "waiting for a database update" | Ask us to run the update. |
| An import row was skipped | The email did not match a contact. Add the contact first, then import again. |
| An import says the basis is missing | Every `granted` row needs `consent` or `existing_customer`. |

**Coming later:** a consent card for WhatsApp in the preference centre, and consent chips on the ABM buying group.

---

## 2. Forms and the preference centre

### What it is for

A **form** is a page, or a box on your website, where a visitor leaves their details. Each submission becomes a contact (if new) and a lead, with the visitor's consent recorded when they tick the box.

The **preference centre** is a page each person can open from your emails to choose which topics they want, or to stop all emails.

### Set it up (once)

You need a web address for your workspace. If your administrator has not set one, a form has no public address. Ask us.

1. Open **Marketing → Forms** and press **+ New Form**.
2. **Basics.** Give it a name (only your team sees it). Check the **Web address**, the **Heading**, the **Introduction** and the **Button words**.
3. **Fields.** Email is always asked. Tick name, company, phone, message and up to three questions of your own. Tick **Required** for the ones that must be filled in. Keep it short; every extra field loses some visitors.
4. **Consent.** Write the words shown next to the tick box. Pick the topics it covers. Pick none to cover every topic.
   - Leave **The box must be ticked to send** off for a contact form. A person can ask a question without agreeing to emails.
   - The box is never ticked in advance.
5. **After sending.** Choose **Show a message** (a thank-you on the form) or **Go to a page** (a page on your own domain, starting with https://). Then choose the emails:
   - **Send a thank-you email** is on. Change **Words in the email** if you like. It is a confirmation of what the person just did, so it goes out even if they did not tick the consent box.
   - **Ask the person to confirm by email** makes a ticked box count only after the person presses a link in that email. It is on for new forms if your workspace is in the European Union and off elsewhere (set this in **Settings → Marketing → Consent and topics → Where you are based**). You can change it on each form.
   - **Tell someone about each new answer** sends one person of your team a short email with the answers.
6. **Share.** Change **Status** to **Live - visitors can send it**. Press **Save**.

Use **Desktop** and **Phone** above the preview to see both layouts.

### Do it day to day

**Put the form on your website:**

1. Open the form and go to **Share**.
2. Press **Copy embed code**. Give it to whoever looks after your website and ask them to paste it where the form should appear.
3. Or press **Copy address** and share the link.

**What happens when someone submits:**

1. The answers are saved (and kept for 180 days).
2. If the email is new, a contact and a prospect company are created. If the email already belongs to a contact, that contact is not changed.
3. If the person ticked the box, their consent is recorded with the exact words they saw. If the form asks for confirmation, it is recorded as **waiting for confirmation** and does not count yet.
4. A lead is created. A second submission by the same person refreshes the same lead.
5. The person gets the thank-you email, with the confirm link if one is owed, and the person you chose is told. On a demo workspace these go to your test inbox, never to the visitor.

**Confirming:** the person opens the link, then presses **Yes, confirm**. The link works for 7 days. After that the page says it has expired and the person fills in the form again. Until they confirm, you cannot email them about that topic.

**Read the answers:** open the form and unfold **Answers** under the preview. It shows the latest 25.

**Preference centre:** you do not build it. Every newsletter has a **Manage preferences** link in the footer. The person sees their topics as switches, a **Save my choices** button, and **Unsubscribe from all**. Opening the page changes nothing by itself.

### What the colours and labels mean

| Label | Meaning |
|---|---|
| Draft | Only you can see it. Visitors get "not found". |
| Live | Visitors can open and send it. |
| Archived | Switched off. |
| Agreed to emails: Yes / No | Whether the visitor ticked the box |
| Already a contact / New contact | Whether the email matched someone you had |
| Waiting for confirmation (on the contact's Consent card) | They ticked the box but have not pressed the link yet. Not counted as a yes. |
| Did not confirm | Seven days passed without the link being pressed. They are not emailed. |

### If something looks wrong

| You see | What to do |
|---|---|
| The page says not found | The form is still **Draft**, or the module is off. Set it to **Live** and press **Save**. |
| No public address | Your workspace has no web address yet. Ask us. |
| The thank-you page will not save | It must start with https:// and be on your own domain. |
| Someone submits but is not in your newsletter audience | They did not tick the box. An unticked box records nothing. |
| A test submission seems missing | You may have hit the limit of 5 submissions an hour from one visitor. Wait and retry. |
| The person did not get the thank-you email | Check **Send a thank-you email** is on. The same person is not emailed twice within an hour. On a demo workspace the email goes to your test inbox instead. |
| A person ticked the box but cannot be emailed | The form asks for confirmation and they have not pressed the link. Look at **Waiting for confirmation** on their Consent card. |

**Coming later:** more field types, form languages, and a submissions screen with filters.

---

## 3. Newsletter Studio

### What it is for

Write a newsletter once in English, add Arabic or another language on top, check it, and send each person their own language. The email is built from blocks (header, hero, text, image, button, columns, product card, event, divider, social, footer).

### Set it up (once)

1. An administrator opens **Settings → Marketing → Brand kit** and sets your logo, colours, an email-safe font, the footer address and social links. Every newsletter uses it.
2. In **Counting opens**, leave the default (off) unless you want opens counted. Clicks are always counted.
3. Optional but useful: set a **Preferred language** on contacts and companies. It appears on their forms once the Studio is on. When someone has none, the company's is used, then English.

### Do it day to day

**Write a newsletter**

1. Open **Marketing → Newsletters** and press **+ New Newsletter**.
2. In **Start**, give it a name, a category and a topic. Then choose how to begin:
   - **Write it for me.** Type one line about the issue, tick whether to use your recent products or campaigns, and press **Write it for me**. AI drafts the blocks in English. It shows what it understood (blue) and what it assumed (amber).
   - **Start from a design.** Pick one of your saved templates or a built-in design.
   - **Blank.** A brand header and footer only.
3. In **Blocks**, click a block to change its words. Drag to reorder. Use **Add** to add more. Under any text you can press **Shorter**, **Friendlier** or **More formal** to get new wording. Use **Undo rewrite** if you do not like it.
4. Write the **Subject** and the **Preheader** (the preview line next to the subject in the inbox).

**AI help and the review step.** AI only suggests. You decide. Nothing is saved until you press **Save**. If you see "AI is not set up for this workspace", you can still write everything yourself.

**Add Arabic (or another language)**

1. Open **Languages**. Pick the language and press **Translate with AI**, or **I'll write it** to type it yourself.
2. AI keeps product names and prices as they are. Lines it was unsure about show an amber **Check this** note in the email, with **Accept** and **Edit**. There is also **Accept all N lines**.
3. A language is ready only when every line is checked. Use **Compare languages** (above the preview) to read English and Arabic side by side.
4. Arabic flips to right-to-left automatically. Check the preview on **Phone** and **Dark** too.

Languages in the list: English, Arabic, Hindi, Urdu, French. Arabic is the one we test most. For the others, read the preview carefully.

**Check Content health.** Open the **Content health** group. Amber items say exactly what to change. Green items are fine. These are fixed rules, not opinions, and not a score. Fix every amber item before you send.

**Save.** **Save** keeps your work and sends nothing. **Save as template** keeps the design for next time.

**Send it**

1. Press **Use in a campaign**. This keeps a copy of the newsletter so editing it later never changes a campaign that already went out.
2. On the **New Campaign** page, name the campaign, choose the **Languages to send** (only fully checked languages can be ticked), the fallback language, and the **Topic**.
3. Choose your audience in **Target audience**. Start with a small group of colleagues. They must already be contacts with a recorded yes for the topic.
4. In **Who will get this**, press **Check the audience**. It shows, for example, "120 of 140 people can be emailed", how many get each language, and a list of who is left out and why, with a fix for each reason. It sends nothing.
5. In **See it as this person**, type a contact or company name. You see the exact email that person would get, in their language.
6. Press **Save draft**. Open the campaign and press **Send now**. A message asks you to confirm. Emails go out at once and cannot be recalled.

### What the colours and labels mean

| Label | Meaning |
|---|---|
| Written first | The English version. Always the base. |
| N to check | That language still has lines marked **Check this** |
| Ready | Every line in that language is checked |
| Amber item in Content health | Something to fix |
| Green item in Content health | That rule is met |
| Draft / Ready / Archived | The state of the newsletter itself |

### If something looks wrong

| You see | What to do |
|---|---|
| A language cannot be ticked in the campaign | It still has lines to check. Accept or edit them in the Studio. |
| "Who will get this" shows fewer people than expected | Read **Who is left out, and why**. Each reason says what to do. |
| Arabic text looks reversed or misaligned | Check the preview with the Arabic tab selected. Report it to us with a screenshot. |
| "Check again" is greyed out | Choose at least one language first. |

**Coming later:** reusable content sections, comments and approvals for teams, suggested subject lines and send times, and a report on which blocks get clicks. Linking a newsletter button to a "buying signals" topic is not yet possible from the editor.

---

## 4. Email health

### What it is for

Some emails never arrive. Email health tells you which addresses work and which do not, so you stop writing to dead addresses. It also protects your sending reputation.

### Set it up (once)

Nothing to set up. It starts working once Newsletter Studio is on and you have sent your first newsletter.

### Do it day to day

**See one person's status.** Open **Contacts**, open the person, go to the **Marketing** tab, and read the **Email health** card.

| Button | What it does |
|---|---|
| **Check this address** | Checks the spelling and whether the company's mail domain can receive mail. Sends nothing. |
| **Fix the address** | You type the right address. The old problem is cleared and the new address is checked. |
| **Mark as checked** | Use when you confirmed the address another way (a phone call). You must say how. Not offered for a bounced or spam-marked address. |

**See everyone with a problem.** Open **Contacts** and press the chip **Email needs attention (n)**. The list shows each person's status, since when, and the company owner. Click a row to fix it.

### What the colours and labels mean

| Label | Colour | Meaning | What to do |
|---|---|---|---|
| Not checked yet | Blue | Not sent to, not checked | Press **Check this address** |
| Working | Green | Delivered, or the check passed | Nothing |
| Trouble delivering | Amber | The last message failed for now (full mailbox, for example). It may clear up. | Wait for the next send, or phone and fix |
| Bounced | Red | The mail server says the address does not exist. **We will not email it again.** | Phone for the right address, then **Fix the address** |
| Marked as spam | Red | The person reported your email as spam. **We will not email it again.** | Do not email. If they ask to hear from you again, record consent and fix the address. |
| Looks invalid | Red | Written wrongly, or the domain cannot receive mail | **Fix the address** |

"Delivered", "bounced" and "complained" come from the email service after each send. When an address hard-bounces, the company owner gets a note.

### If something looks wrong

| You see | What to do |
|---|---|
| A person says they did not get your email | Check their card. If it says **Working**, ask them to check spam. If **Bounced**, fix the address. |
| A bounced person cannot be marked as checked | This is on purpose. Only a new address clears it. Use **Fix the address**. |
| The card says "waiting for a database update" | Ask us. |
| No status ever changes | The email service sends results to us. If nothing updates after a send, tell us. |

---

## 5. Scored leads

### What it is for

A lead gets a score from what the person did (clicked an email, opened a quote, filled in a form) and who they are (their company and role). When the score is high enough, the lead becomes **Ready for sales** and goes to a salesperson, who has a deadline to respond.

The score is worked out by fixed rules. It is never a guess by AI.

### Set it up (once)

1. **Settings → Marketing → Scoring** (administrator).
   - **What people do:** each action earns points. You can change the points, how fast they fade, and a weekly limit.
   - **Who they are:** extra points for kind of company, country or role. These do not fade.
   - **Where the lines are:** **Engaged from** and **Ready for sales from**. The standard lines are 20 and 60.
   - **Try it on a sample lead:** pretend a lead did certain things and see the score. Nothing is saved.
2. **Settings → Coverage:** open a team and choose **Who gets new sales-ready leads**: **The team lead**, or **Each member in turn**.
3. **Settings → Marketing → Hand-over** (administrator):
   - **Leads by themselves:** switch on **Make a lead when someone becomes Engaged**. Off by default.
   - **Response time:** the working days a salesperson has, and the **Days off** (for example Friday and Saturday). The standard is one working day with Sunday off.
   - **When no team covers it:** add the people who take new leads in turn. With nobody here, the oldest administrator has them.
   - **When a lead is overdue:** choose whether the **owner** and/or the **team lead** is told in the Nova inbox.

### Do it day to day

1. Open **Marketing → Scored leads**. The best score is at the top.
2. Use the chips to filter: **All**, each stage, and **Overdue**.
3. Open a lead. The page shows the score and **Why 72?** (your number will differ). It lists each reason with its points, with what they did first, then who they are. It also shows how many points remain to reach the next stage.
4. On a lead that is **Ready for sales**, press **Pick this up**. It becomes yours and moves to **Working**.
5. Use **Stage** on the right to move the lead (for example to **Deal** or **Not now**) and add a note. Use **Owner** to choose someone, or **Take this lead**.
6. **Score again** works the score out right now. It is otherwise refreshed about every 15 minutes, and points fade as actions get older.
7. With **Make a lead when someone becomes Engaged** on, a person who has no open lead and has done enough to be Engaged gets one by themselves, within about 15 minutes. It is titled "Interest from" and their name, with the source **Inbound**. It then moves on and is handed over like any other lead. It only looks at what people did after you switched it on.

### What the colours and labels mean

| Stage | Meaning |
|---|---|
| New | Just arrived |
| Engaged | Showing real interest, not ready for a call |
| Ready for sales | A salesperson should call now |
| Working | A salesperson has taken it |
| Deal | Turned into a deal |
| Customer | Bought from you |
| Not now | Not the right time |
| Not a fit | You will not pursue it |

Scoring moves a lead up through New, Engaged and Ready for sales by itself. It never moves it down, and never touches a lead a person has taken on.

| Other label | Meaning |
|---|---|
| Respond by (amber) | Time left to respond |
| Overdue (red) | Still **Ready for sales** and past the time. **Working** stops the clock. |
| Needs an owner (amber) | Ready, but nobody has it |
| No coverage matched, so an admin has it (amber) | No team owns this company, so the oldest administrator was given it |
| No coverage matched, so it went to the next person on your hand-over list | No team owns this company, so the next person on your **Hand-over** list was given it |

### If something looks wrong

| You see | What to do |
|---|---|
| "Not scored yet" | Press **Score again** or wait for the next run |
| A lead is stuck on "New" | Nothing has added points. The score rises as the person clicks, opens quotes or fills in forms. |
| Too many leads are Ready | Raise **Ready for sales from** in Scoring, or lower the points for small actions |
| The wrong person got a lead | Check the team setting in **Settings → Coverage**, the list in **Settings → Marketing → Hand-over** and the company's owner |
| Nobody is told about an overdue lead | In **Hand-over → When a lead is overdue**, choose who to tell. The message appears in the Nova inbox, so your workspace needs Nova. Each lead is announced once. |
| No leads appear by themselves | Check **Make a lead when someone becomes Engaged** is on. People who were already Engaged before you switched it on are not added. |

**Coming later:** reassigning an overdue lead by a rule, and Score and Stage columns on the existing **Leads** page. The existing **Leads** page is unchanged; **Scored leads** is the new view.

---

## 6. Journeys

### What it is for

A journey is a set of steps that runs by itself after something happens, for example "a quote is sent". It can wait, send a newsletter, create a task for the owner, or notify the owner. Consent and quiet hours are always respected.

### Set it up (once)

Before your first journey you need a **kept newsletter version** to send. Make a newsletter in Newsletter Studio and press **Use in a campaign** once (you do not have to send it).

The safety limits apply to your whole workspace:

| Limit | Standard value |
|---|---|
| Quiet hours | No sends from 20:00 to 08:00 |
| Weekly day off | Friday |
| Emails per person | At most 1 a day across all journeys |
| Company in trouble | Pause promotional steps if a case has been open over 30 days or an invoice is overdue |
| Big groups | A confirmation is asked if more than 200 people would enter |

Messages wait for the next allowed time. They are never dropped. To change these limits, ask us.

### Do it day to day: the Quote follow-up example

1. Open **Marketing → Journeys** and press **+ New Journey**. Pick **Quote follow-up**, and press **Create journey**.
2. This journey does the following: a Standard Quote is sent, wait 3 days, send a newsletter version, create a task for the owner to call.
3. In the **Send a newsletter version** step, choose your kept newsletter version and the topic (**Offers** is the standard).
4. Under **Who would enter today**, read the count and the messages. They tell you about people with no consent and people who could get more than one email a day.
5. **Try it on one person.** Type at least two letters of a name, pick a person, and press **Show the path**. You see Day 0, Day 3 and so on, with the reason at every turn. Nothing is sent and nothing is saved.
6. Press **Save**.

**Going live safely**

1. Press **Turn on**. If the group is large, a message lists the count and asks you to confirm.
2. When you turn it on, people from matching events in the last 3 days also enter (the "Include the last (days)" setting; use 0 for new events only). Check the count first.
3. Steps are locked while the journey is on. Press **Pause** to change them.
4. Steps run within about five minutes.

**Watch it.** Under **What is happening** you see how many entered, are waiting, are **stuck**, were skipped or held, emails sent and tasks created. Click a reason to see the people. Open **Run log** for the detail. Tasks for the owner appear here with **Mark done**.

### What the colours and labels mean

| Label | Meaning |
|---|---|
| Draft | Not running |
| On | Running |
| Paused | Not sending. People keep their place. |
| Archived | Finished. The log stays readable. |
| Stuck | A step is far overdue or failed after retries. The log says why. |
| Skipped or held: No consent | The person has not said yes to that topic. The journey carries on without that email. |
| Skipped or held: Quiet hours | Waiting for the quiet hours or the day off to end |
| Skipped or held: Daily limit | They already had a journey email in the last 24 hours |
| Skipped or held: Open urgent case | The company has an old open case or an overdue invoice |
| Skipped or held: Nobody to contact | No contact person, or no email address |
| Skipped or held: Needs setting up | No newsletter version chosen, or the Studio is off |

Under every step a sentence says when it fires and what can hold it back ("Held or skipped if").

### If something looks wrong

| You see | What to do |
|---|---|
| Nobody enters | Check the trigger and any condition. Quote follow-up starts only for a Standard Quote. |
| Many people "No consent" | The journey is working correctly. Record consent only where you truly have it. |
| A step says "Needs setting up" | Choose a newsletter version in the send step |
| Someone is stuck | Open the run log. Fix the cause (for example the address) and the next run continues. |
| You want it to stop now | Press **Pause**. |

**Coming later:** health and step results, branching paths, more ready-made journeys (welcome, renewal, gone quiet), a screen for quiet hours and limits, and ABM plays on the same engine.

---

## 7. Buying signals

### What it is for

Buying signals tells you which companies look close to buying. It adds up what each company did with you (asked for a quote, clicked a link, has a contract about to end) and gives a stage in plain words.

It uses your own data only. It does not use news or tenders yet. It is never an AI guess.

### Set it up (once)

1. Open **Marketing → Buying signals**.
2. An administrator opens **Topics** and adds the subjects you sell, for example Precast or Fire safety.
3. Press **Rescore now** (administrator) the first time, so scores appear at once.

Scores then refresh by themselves every few hours.

### Do it day to day

1. Open **Who is in market**. The highest score is at the top.
2. Use **Options** on the left to filter by stage, topic, owner, or **Moved up this week**.
3. Read each row: the stage, the score with an eight-week line, a one-line reason, the owner, and a suggested next step.
4. Click a row to open the company. You see:
   - **How this is worked out**: every point with its source and date.
   - **Signals timeline**: the last events that moved the score, newest first.
   - **Open account** and **Not in market** (use this to record that the company is not buying, and **Clear "not in market"** to undo it).
5. Open **Did it work?** and pick a sent campaign or newsletter. It compares each recipient's stage in the 14 days before and after.

**Reading the reason line.** The reason is built from the two strongest signals in plain words, for example "Comparing: asked for a quote and clicked a link about Precast". It never hides anything: open the company to see every line.

**Use the stage in a target group.** In **Segmentation**, add a rule from the group **Buying signals**: **Buying stage**, **In-market score**, **Days in current stage**, or **Engaged with topic**. For example, "Buying stage is Comparing" and "Engaged with topic contains Precast". Use that group for a campaign.

### What the colours and labels mean

| Stage | Meaning |
|---|---|
| Quiet | Nothing recent to go on |
| Looking | Has shown some interest |
| Comparing | Asked you for something, or is clearly engaged |
| Deciding | Asked you for something and is very engaged |

| Label | Meaning |
|---|---|
| Warming / Cooling / Steady | Movement from the previous stage or the week's change |
| A highlighted row | Moved up a stage in the last 7 days |
| Next step | Deciding: Call. Comparing: Follow up or Start a quote. Looking: Add to a campaign. |

Older signals count for less: full for 14 days, then half, a quarter, and gone after 60 days.

When an account moves up to Comparing or Deciding, the company's owner gets a note.

### If something looks wrong

| You see | What to do |
|---|---|
| "No signals yet" | Signals appear as your team sends quotes and campaigns. An administrator can press **Rescore now**. |
| A company is Quiet but you know it is active | Only what is recorded counts. Check that quotes and deals are entered in BPMSquare. |
| A score dropped | Old signals fade. This is expected. |
| The company is not buying | Open it and press **Not in market**. |

**Coming later:** news, tender and job sources, a program heatmap, suggested plays, website visits as a signal, and a way to tag newsletter links with a topic from the editor.

---

## 8. ABM programs

### What it is for

Account-based marketing (ABM) means you pick a list of companies you really want and work them as a team, instead of mailing everyone. A program holds the list, the people at each company (the buying group), the progress of each company, and the results.

### Set it up (once)

Nothing to set up in Settings. Decide your list and your goal first. Buying signals is optional, but when it is on, each company also shows its buying stage.

### Do it day to day

**Create a program**

1. Open **Marketing → ABM programs** and press **+ New Program**.
2. Fill in:
   - **Name**, for example "Riyadh developers 2027".
   - **Kind**: **New business** (companies you do not serve yet) or **Expansion** (companies you already serve).
   - **Owner**, **Goal** (one plain sentence), **Measured in** (Deals won, Deals opened, Accounts engaged, or Revenue), **Target**, and the dates.
   - **Default tier**: 1:1 (its own plan, worked personally), 1:few (a small cluster) or 1:many (the program's standard approach).
   - **Roles every company needs**: decision maker and influencer are the standard.
   - **Source**: start empty, or copy a marketing target group or a Coverage segment.
3. Press **Create program**, then press **Start**. **Pause** and **Resume** are in the same place.

**Add target accounts**

1. In **Target accounts**, press **+ Add accounts**.
2. Choose **By name**, **From a marketing target group** or **From a Coverage segment**. For a group or segment, press **Preview** first.
3. The list is copied once and does not change by itself. Use **Refresh from source** to see what is new and what no longer matches. Nothing changes until you tick it and press **Apply**.

**Build the buying group**

1. Click a company. Open **Buying group**.
2. Press **+ Add person** and pick a contact at that company. Choose their **Role in this program** (Decision maker, Influencer, User, Blocker, Unknown). A person who is not a contact yet must be added to the company first.
3. Use **Call first** to mark who to phone first.
4. A **missing role** shows as a grey row, for example "No decision maker yet", with an **Add one** button. On the program, the **Buying groups** tab lists every company with a gap. Naming a person sends nothing.

**Progress.** Press **Check progress** (on the program or on one company). It looks at quotes, emails and deals and moves companies forward by fixed rules. It does not run by itself yet.

To set progress by hand, open the company and press **Update progress**. You must give a reason ("Site meeting on 3 Nov"). It is kept with your name and the date. **Dropped** needs a reason too.

**Plan.** On the company's **Plan** tab, set **What happens next**, **Due on**, **Who does it**, the **Tier**, the owner, and link the **Deal this program is pursuing**. A linked deal moves the company to **Deal open**, then **Won** or **Lost** when it closes.

**Results.** On the program, open **Results**. You see the funnel: Targets, Reached, Engaged, In talks, In a deal, Won. You also see the goal sentence, the money from linked deals, and results by tier.

### What the colours and labels mean

| Progress | Meaning |
|---|---|
| Planned | In the program, nothing has happened yet |
| Reached | Something was sent to someone in the buying group (an email or a quote) |
| Engaged | Someone in the buying group did something (clicked, opened a quote, filled in a form) |
| In talks | A meeting happened. Only a person can set this. |
| Deal open | A deal is linked |
| Won / Lost | Follows the linked deal |
| Dropped | You stopped pursuing it. A reason is required. |

Click any progress pill to open **Why this status?** It names the rule, the events behind it with dates, and what would move it next.

By default a company is not marked **Engaged** until the required roles are filled. The pill then says it would be Engaged, but no decision maker is named. This is on purpose.

**Buying stage, Progress and Next step** always show together.

### If something looks wrong

| You see | What to do |
|---|---|
| Progress does not move | Press **Check progress**. Only events from people in the buying group count. |
| A company stays on Reached | A required role is missing. Add the person. |
| New companies match your group but are missing | The list is a copy. Use **Refresh from source**. |
| "Fewer than 20 targets" note | Read the results as a list, not a trend |

**Coming later:** plays (journeys for a program), a "My ABM day" page, quick actions on rows, and Settings for default roles.

---

## 9. Process Design Studio

### What it is for

This is for prospects and new clients. You describe how your business works, and the Studio shows how BPMSquare fits, what we would change, and a plan with dates. You send it to us and we call you back. Allow about twenty minutes.

### Set it up (once)

Nothing to set up. Open **Process Design Studio** in the menu under **Dashboard**.

### Do it day to day

1. Press **+ New Study**. Give it a name (your company, or the part you want to look at), and press **Start**.
2. **Tell us.** Answer in your own words. In **Areas of your business** (Sales, Service & repairs, Production & delivery, Procurement, Workforce, Pricing & estimating, Marketing, Finance), tap an area to answer three short questions, or switch off an area that does not apply. You can add documents you already have. Press **Build my process map** when you are done.
   - **Ask me follow-up questions** (on or off) lets the studio ask up to three short questions after each answer.
3. **Your process.** Read the map. It is drafted from what you told us. Rename a step or a role, add a role, and use **Add a step** for anything we missed. Steps we added only because the order needed them have a dashed border: remove any that are wrong.
4. **How BPMSquare fits.** Read the **fit report**: one line per step with a rating and the module or screen behind it. Open a line for the reason. Use **Check again** after you edit the map.
5. **What we'd change.** One card for every partly or not covered line, with a size (**Small**, **Medium**, **Large**). Press **We can live without this** on any you do not need, or add your own with **Add this change**.
6. **Your plan.** Phases, tasks, who does what. Set the **Start date** and **Weekend**, change durations, tick a phase when it looks right, and leave comments. Press **Save**.
7. **Talk to us.** Enter your name and an email for the call-back, and press **Send to BPMSquare**. You can also **Download PDF**.

### What the colours and labels mean

| Rating | Meaning |
|---|---|
| Standard | Works out of the box; you only load your data |
| Needs setup | Standard once an admin sets it up in Settings |
| Partly covered | Most is there; a piece needs a change we list |
| Not covered | Not in BPMSquare today. We say what we would build, or what to keep elsewhere. |
| Needs review | We could not back it with something real, so a person at BPMSquare checks it |

| Size | Meaning |
|---|---|
| Small | A setting or your own fields: hours |
| Medium | A change just for your workspace, or an existing connector: days |
| Large | Something new in the product or a new integration: weeks |

The banner says **Draft** until BPMSquare has reviewed every line. Then it says **Reviewed by BPMSquare**. Every size and date is **Indicative**, never a price. It is confirmed on the call.

### If something looks wrong

| You see | What to do |
|---|---|
| "No steps yet" on Your process | Go back to **Tell us**, add answers, and press **Build my process map** |
| A step or rating looks wrong | Edit the map and press **Check again**, or tell us on the call |
| You changed your mind after sending | Press **Send a new version**. Older versions are kept. |
| A later step is locked | Complete the step before it first |

We reply within two working days. The studio talks in English for now; Arabic is planned.

---

## 10. A day in the life

Ten minutes a day is enough once everything is set up.

### The marketer (10 minutes)

| Minutes | Do this |
|---|---|
| 2 | **Newsletters** or **Campaigns**: open the last send. Look at clicks and what was skipped. |
| 2 | **Contacts → Email needs attention**: fix a few addresses. |
| 2 | **Journeys**: read **What is happening**. Look at **stuck** and the skipped reasons. |
| 2 | **Forms**: read the newest answers. Reply to anyone who asked a question. |
| 2 | Draft next week's newsletter. Check **Content health**. Use **See it as this person** on one contact. |

### The salesperson (10 minutes)

| Minutes | Do this |
|---|---|
| 3 | **Scored leads → Overdue** and **Ready for sales**. Press **Pick this up** on yours. Call the best one first. |
| 3 | **Buying signals → Moved up this week**. Call every company at **Deciding**. |
| 2 | Open a lead and read **Why** before you call, so you know what they did. |
| 2 | Update stages and add a note. Mark journey tasks **Done**. |

### The ABM owner (10 minutes)

| Minutes | Do this |
|---|---|
| 2 | Open your program. Press **Check progress**. |
| 3 | **Buying groups** tab: fill the gaps ("No decision maker yet"). |
| 3 | Open companies that moved: click **Why this status?** and set **What happens next**. |
| 2 | **Results**: read the funnel and the goal sentence. |

---

## 11. Glossary

| Term | Plain meaning |
|---|---|
| Consent | A person's recorded "yes, you may contact me about this" |
| Withdrawal | A person's recorded "no" or "stop". It is never deleted. |
| Topic | A subject people can agree to separately (in Consent), or a subject you sell (in Buying signals) |
| Basis | The reason you may contact someone: they agreed, or they are an existing customer |
| Preference centre | The page where a person chooses their topics or unsubscribes |
| Block | One piece of a newsletter (text, image, button) |
| Content health | A checklist of fixed rules a newsletter must pass before sending |
| Bounce | An email that could not be delivered |
| Complaint | A person marked your email as spam |
| Score | Points added up from what a person did and who they are |
| Ready for sales | A lead with a high enough score for a salesperson to call |
| Journey | Steps that run by themselves after an event |
| Quiet hours | The hours when no journey email is sent |
| Buying stage | How close a company looks to buying: Quiet, Looking, Comparing or Deciding |
| Target group | A saved list of companies defined by rules, used for campaigns |
| Buying group | The people at one company who take part in a purchase |
| Tier | How personally you work a company: 1:1, 1:few or 1:many |
| Fit report | The Process Design Studio's line-by-line view of how BPMSquare covers your process |

---

## 12. Getting help

If something looks wrong, send us three things:

1. **A screenshot** of the whole screen, including the menu.
2. **The name of the page**, as it appears at the top (for example "Scored leads" or "Journeys").
3. **The time** it happened, with your time zone. If it is about one person or company, send their name.

Please do not send passwords. Do not send lists of customers by email: tell us the page and we can look.

Things that are normal, and not a fault:

- "Waiting for a database update": we run it for you. Just tell us.
- A menu item missing: the module is not switched on yet.
- A person left out of a send: read **Who is left out, and why**.
