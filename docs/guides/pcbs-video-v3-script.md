# Walkthrough video v3: script (owner's order, 2026-10-21)

Full screen at 1920×1080, demo workspace, English voice from Clipchamp, music
under it. Target 11–13 minutes. Scene order is the owner's: CRM → features →
spaces → assistant → talk to data → connectors → pricing on a quote →
estimates and fence → marketing → dashboard close with privacy and hosting.

## Before recording

1. S1 of the assistant merged and deployed to the demo (scene 4).
2. Bundle 7 run on production (Wire Rope bands, hand-over seed) so scene 7
   shows the band from the product's own price list.
3. Flags on for the demo: AI assistant, AI report builder, Nova, Estimates,
   Fence projects, Dynamic pricing, Marketing campaigns, Newsletter Studio,
   Journeys, Forms, ABM, Lead scores, Connectors.
4. Slides (I build them): 1 title/CRM, 2 features map, 6 ERP (exists), 4 AI
   (exists, refresh the six tiles to match S1), 10 privacy and hosting, end.
5. Close the browser's extra tabs; 20-tab limit in the workspace tab strip
   (close old ones first); hide the Chrome debugging banner (cropped in the
   edit anyway).

## Scenes and voice-over

| # | On screen | Target |
|---|---|---|
| 1 | Slide: BPMSquare AI CRM | 25 s |

A CRM is where a company keeps everything about its customers in one place: who they are, what they asked for, what was quoted, and what happened next. Most CRMs stop there. BPMSquare is an AI CRM built for companies that sell projects: it also prices the work, plans it, and follows up, in English and Arabic. This is a short walkthrough.

| 2 | Slide: the features map (Sales · Service · Marketing · Pricing and estimating · Workforce · Insights · Integration · AI) | 45 s |

One platform, eight parts. Sales: accounts, contacts, quotations, standard quotes, pipeline and invoices. Service: cases, work orders, AMC contracts, dispatch and technicians. Marketing: newsletters, journeys, forms, lead scoring, buying signals and account-based programs. Pricing and estimating: price books, cost-based and price-list pricing, the project estimator and the fence design studio. Workforce: attendance, rosters, leave and overtime. Insights: dashboards, analytics and reports you ask for in plain words. Integration: your ERP, Dynamics 365, email, calendar, Slack, a REST API. And AI across all of it.

| 3 | Dashboard → Spaces rail: open each space, its menu flies out | 40 s |

Everything is grouped into spaces: Home, Sales, Service, Marketing, Master data, Workforce, Insights and Admin. Open a space and its menu opens beside it. Favourites pin what you use every day, and the top bar searches every object at once.

| 4 | The slider: open on a quote; context line, suggestion chips; ask "what is this quote's total and who owns the account"; click a suggestion; ask "open products"; usage pill `i` | 75 s |

On every screen, a slider at the bottom right opens your assistant. It knows where you are: this quote, this customer. Ask in plain words: what is this quote's total, who owns the account. It answers from your live data, and follow-up questions keep their context. It also suggests the next step, worked out from the record in front of you, and it takes you where you ask: say "open products" and you are there. Every answer counts against a monthly allowance, shown here, so cost is never a surprise. It reads; it does not change anything: actions come next, each one confirmed by you.

| 5 | Analytics → Talk to data: type "quotes by status this month as a chart", change it to a table, save, put on dashboard | 45 s |

On the Analytics page, Talk to data goes further. Describe a report in your own words and BPMSquare builds it: the question becomes a query against your data, never a guess, and the chart type is chosen by the engine. Change it, save it, and put it on your dashboard. Every number can be traced back to the records behind it.

| 6 | Settings → Connectors (Dynamics 365 card, Slack, Gmail, Google Calendar); Dynamics set-up page (login types, entities, Preview); then the ERP slide | 70 s |

BPMSquare integrates with your ERP, any ERP, including ePROMIS. For Dynamics 365 there is a ready connector: choose the login type, map the entities, preview the real fields, sync on a schedule. For every other system the same three lanes are open: files through Data Workbench, a REST API with a change feed and signed webhooks, and connectors. From the ERP, your materials, suppliers, accounts and price lists with their quantity scales are replicated, so there is one source of truth. From BPMSquare, once a quote is won, the project or the order is created in your ERP. Email, calendar and Slack connect in a minute each.

| 7 | Pricing → Today's rates; the price-book list; Standard Quote: Wire Rope 40 m → Price → 420; change to 150 → 390; open the why chip ("from the product's own price list, band from 100") | 75 s |

Prices come from rules you can read. Today's rates shows what is live in plain language: freight, handling, margin by region. A price book can be a catalogue, a formula, or cost plus a mark-up, and your team decides which book applies to which product group. Quantity scales live on the product, replicated from your ERP: forty metres of wire rope is priced at list; one hundred and fifty metres steps down to the next band on its own, and the line shows which band applied and why.

| 8 | Estimator: new estimate, paste the email, Fill in, create account and contact, the villa in 3D, price, how the price is built, create quote; BOM with kit components; Fence projects: 3D view, quantities | 150 s |

Email is where work starts. Paste the customer's message into a new estimate and BPMSquare reads it: two floors, two hundred and twenty square metres per floor, premium finish, stairs, a boundary wall, and who sent it. One click creates the account and the contact. Here is the building, made from those numbers, with the actual precast pieces. Change the finish and the price updates. Your team can open how the price is built: materials, production, transport, erection, overhead, margin and VAT, with the casting schedule and a risk range. One click turns it into a customer quote: prices, not your costs. The bill of materials comes from your product catalogue: a kit is made of its parts and its cost rolls up from them. The same system handles any kind of project. In the Fence Design Studio, set the length, posts, mesh and gates, see it in plan and in three dimensions, and the quantities list builds itself.

| 9 | Marketing: Newsletter in English and Arabic (compare languages, phone preview); Journey (quote follow-up); Lead scores list + Settings → Hand-over; ABM program with buying groups | 110 s |

Marketing works from the same customer records. The Newsletter Studio drafts the email and translates it into Arabic; every translated line waits for a person to approve it, and it goes only to people who agreed to hear from you. A journey is a follow-up you set once: three days after a quote, a newsletter goes out and the owner gets a task. Leads score themselves from what people do, and the hand-over is a setting: response time, days off, who hears when a lead is overdue. For the companies that matter most, an account-based program tracks each target through its buying stage and shows who in the buying group still needs to be reached.

| 10 | Dashboard (curated layout), then the privacy and hosting slide, then the end slide | 60 s |

Everything comes together on the dashboard: pipeline, cases, invoices, the news that matters to your accounts. And your data stays yours. Each company's data is isolated in its own workspace; personal details are encrypted at rest; consent is recorded before any marketing message is sent; every change is logged. You choose where it lives: in your own private cloud, on your database, or in a public-cloud data centre near you. BPMSquare integrates with your ERP, shaped around your business. Thank you.

## Slides to build

- **1 Title**: logo, BPMSquare, AI CRM, one line.
- **2 Features map**: eight tiles with three or four words each.
- **4 AI**: existing `slides/ai.html`, tiles refreshed to: Your assistant knows the screen · Suggests the next step · Takes you there · Talk to your data · Records from an email · Newsletters in English and Arabic.
- **6 ERP**: existing `slides/erp.html`.
- **10 Privacy and hosting**: four facts (isolated workspace, encrypted personal data, consent before sending, change log) and the two hosting choices. **Owner to confirm the exact hosting offer** (private cloud on the client's database; public cloud region) before this slide is final.
- **End**: existing `slides/end.html`.

## Recording plan

Same method as v2: ffmpeg desktop capture, markers per scene
(`mark.py`), one take per scene in the order above, then the edit that cuts
idle time to the voice length, inserts the slides, and produces the silent
file plus the scene times for Clipchamp.
