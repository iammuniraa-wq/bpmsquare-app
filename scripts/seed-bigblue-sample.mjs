/**
 * Sample data for the Big Blue prospect tenant (Doha, Qatar -- engineered
 * products: rebar, dowel bars, bridge bearings, fasteners, safety gear).
 * Written 2026-09-07 for the pitch in docs/BPMSquare_for_BigBlue_Pitch.pptx.
 *
 * What it seeds, into the tenant whose slug is `bigblue` (override with
 * --slug=<slug>), and only after that tenant exists:
 *   - feature flags + config (currency QAR, product category tree, Asia/Qatar
 *     timezone, VAT 0, redirect-only email output, Price Book routing)
 *   - 8 contractor/consultant accounts, 10 contacts, 5 suppliers
 *   - 18 products across 6 families, with cost prices, cost dates, quantity
 *     breaks and one made-to-order cost sheet
 *   - two PUBLISHED Price Books: "default" (Cost-based: landed cost + margin
 *     by customer tier/region, floor 12 %, policy block) and "steel_catalog"
 *     (Catalog + Formula for rebar and dowel bars: a negotiated mill rate per
 *     spec, a steel-index / list-price formula for every other spec)
 *   - 6 deals on the pipeline board, 5 Standard Quotes (sent / draft /
 *     accepted / rejected) with quantity-break offers and an alternative
 *     option group, linked to their deals
 *
 * The tenant itself is NOT created here -- TENANT_PROVISIONING.md §1: real
 * tenants are created in /admin/tenants/new only. Create it there first
 * (slug `bigblue`, domain bigblue.bpmsquare.com), then run this.
 *
 * Run:   node scripts/seed-bigblue-sample.mjs             seed (idempotent)
 *        node scripts/seed-bigblue-sample.mjs --cleanup   remove EVERY
 *              account/contact/supplier/product/deal/quote/price-book row
 *              in the tenant -- only while it holds nothing but this sample
 *        node scripts/seed-bigblue-sample.mjs --slug=x    another tenant
 *
 * Target database: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
 * the environment; falls back to .env.local (the dev database) when neither
 * is set. To seed PRODUCTION, set both to the production project's values in
 * the shell before running -- never paste them into a file in the repo.
 *
 * Multi-tenant guardrails: the service-role client bypasses RLS, so every
 * read, insert and delete below carries .eq("tenant_id", tenantId). PII
 * (account/contact phone + email) is left empty on purpose -- the app
 * encrypts those fields on write and this script has no key; add a contact
 * email through the UI if the demo needs one. Supplier emails are .example
 * addresses (that table is not PII-encrypted, same as seed-pricing-cost-
 * based-demo.sql).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const CLEANUP = args.includes("--cleanup");
const SLUG = (args.find((a) => a.startsWith("--slug=")) ?? "--slug=bigblue").slice("--slug=".length);

function loadEnv() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return { url, key, source: "environment" };
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
  if (existsSync(envPath)) {
    const env = Object.fromEntries(
      readFileSync(envPath, "utf8").split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
    url = url || env.NEXT_PUBLIC_SUPABASE_URL;
    key = key || env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) return { url, key, source: ".env.local" };
  }
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (or .env.local for dev).");
}

const env = loadEnv();
const sb = createClient(env.url, env.key);
const projectHost = new URL(env.url).host;

function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }
function ok(msg) { console.log(`  ✓ ${msg}`); }
function unwrap(res, what) { if (res.error) die(`${what}: ${res.error.message}`); return res.data; }
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const dateOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const missingTable = (err) => err && (err.code === "42P01" || /does not exist|schema cache/i.test(err.message ?? ""));

// ── Tenant ───────────────────────────────────────────────────────────────
const tenant = unwrap(
  await sb.from("tenants").select("id, name, slug, custom_domain, is_demo, features, config, company_info").eq("slug", SLUG).maybeSingle(),
  "tenant lookup"
);
if (!tenant) die(`No tenant with slug "${SLUG}" on ${projectHost}. Create it in /admin/tenants/new first (TENANT_PROVISIONING.md §1).`);
if (tenant.is_demo) die(`Tenant "${SLUG}" is the is_demo tenant -- this script is for the Big Blue tenant only.`);
const T = tenant.id;
console.log(`\nTarget: ${projectHost} (${env.source}) → tenant "${tenant.name}" [${tenant.slug}] ${tenant.custom_domain ?? "(no domain)"}`);

// ── Sample data ──────────────────────────────────────────────────────────
// Region = accounts.state (the pricing context's `region`); customer tier =
// accounts.type (`customer.tier`) -- see src/lib/pricing/routing.ts.
const ACCOUNTS = [
  { ref: "ACC-0001", name: "Al Khaleej Contracting W.L.L.", type: "direct",   city: "Doha",       state: "Doha",       industry: "Civil contractor",              employee_count: "1000+", website: "alkhaleej-contracting.example", address_line1: "Building 14, Street 850, Industrial Area", notes: "Main contractor on North Field East Package 3. Buys rebar and dowels by the tonne; wants mill certificates with every delivery." },
  { ref: "ACC-0002", name: "Doha Infrastructure Company",   type: "direct",   city: "Doha",       state: "Doha",       industry: "Roads & bridges contractor",    employee_count: "500-1000", website: "dohainfra.example", address_line1: "Tower 2, West Bay", notes: "Expressway and interchange packages for Ashghal. Specifies PTFE and elastomeric bearings." },
  { ref: "ACC-0003", name: "Lusail Build JV",               type: "direct",   city: "Lusail",     state: "Lusail",     industry: "High-rise & mixed-use contractor", employee_count: "500-1000", website: "lusailbuild.example", address_line1: "Marina District, Lusail", notes: "Joint venture; procurement runs through the JV commercial team." },
  { ref: "ACC-0004", name: "Gulf Bridge Contractors",       type: "direct",   city: "Al Wakrah",  state: "Al Wakrah",  industry: "Marine & bridge works",         employee_count: "200-500", website: "gulfbridge.example", address_line1: "Al Wakrah Port Road", notes: "Marine works; regular buyer of SS316 dowels and custom bearings." },
  { ref: "ACC-0005", name: "Ras Laffan Civil Works",        type: "direct",   city: "Ras Laffan", state: "Ras Laffan", industry: "Industrial civil works (LNG)",  employee_count: "200-500", website: "rlcw.example", address_line1: "Ras Laffan Industrial City", notes: "Deliveries need gate passes; freight surcharge applies (see Price Book)." },
  { ref: "ACC-0006", name: "Wakrah Marine Construction",    type: "prospect", city: "Al Wakrah",  state: "Al Wakrah",  industry: "Marine contractor",             employee_count: "50-200",  website: "wakrahmarine.example", address_line1: "Al Wakrah", notes: "Quoted PPE once; lost on price to a Sharjah trader." },
  { ref: "ACC-0007", name: "Peninsula Consulting Engineers", type: "prospect", city: "Doha",      state: "Doha",       industry: "Consulting engineer (specifier)", employee_count: "50-200", website: "peninsula-ce.example", address_line1: "Al Sadd", notes: "Specifier, not a buyer -- influences bearing and dowel specs on Ashghal packages." },
  { ref: "ACC-0008", name: "Qatar Metro Package 4 JV",      type: "prospect", city: "Doha",       state: "Doha",       industry: "Rail infrastructure JV",        employee_count: "1000+", website: "qmp4jv.example", address_line1: "Msheireb", notes: "Six-station package; dowel bar tender expected Q4." },
];

const CONTACTS = [
  { ref: "CON-0001", account: "ACC-0001", name: "Khalid Al-Mansoori", role: "Procurement Manager",  department: "Procurement" },
  { ref: "CON-0002", account: "ACC-0001", name: "Ravi Menon",         role: "Quantity Surveyor",    department: "Commercial" },
  { ref: "CON-0003", account: "ACC-0002", name: "Fatima Al-Thani",    role: "Project Director",     department: "Projects" },
  { ref: "CON-0004", account: "ACC-0002", name: "Joseph Mathew",      role: "Site Engineer",        department: "Site" },
  { ref: "CON-0005", account: "ACC-0003", name: "Ahmed Hassan",       role: "Procurement Lead",     department: "Procurement" },
  { ref: "CON-0006", account: "ACC-0004", name: "Sarah Mitchell",     role: "Commercial Manager",   department: "Commercial" },
  { ref: "CON-0007", account: "ACC-0005", name: "Mohammed Al-Kuwari", role: "Materials Engineer",   department: "Engineering" },
  { ref: "CON-0008", account: "ACC-0006", name: "Nikhil Sharma",      role: "Buyer",                department: "Procurement" },
  { ref: "CON-0009", account: "ACC-0007", name: "Dr. Omar Farouk",    role: "Structural Lead",      department: "Structures" },
  { ref: "CON-0010", account: "ACC-0008", name: "Elena Rossi",        role: "Package Procurement",  department: "Procurement" },
];

const SUPPLIERS = [
  { ref: "SUP-0001", name: "Gulf Rebar Mills FZE",             type: "vendor",        city: "Jebel Ali", email: "rebar@gulfrebar.example",        notes: "B500B rebar; monthly mill rate, 30-day validity." },
  { ref: "SUP-0002", name: "Hangzhou Dowel & Fastener Co.",    type: "vendor",        city: "Hangzhou",  email: "export@hzdowel.example",         notes: "Dowel bars (plain, epoxy, SS316), anchor bolts. 6-8 weeks sea freight." },
  { ref: "SUP-0003", name: "Antwerp PTFE Bearing Systems",     type: "vendor",        city: "Antwerp",   email: "sales@antwerp-ptfe.example",     notes: "PTFE sliding and guided bearings; custom units on drawing." },
  { ref: "SUP-0004", name: "Sharjah Safety Supplies",          type: "vendor",        city: "Sharjah",   email: "orders@sharjahsafety.example",   notes: "PPE, EN-certified." },
  { ref: "SUP-0005", name: "Doha Logistics & Clearance",       type: "subcontractor", city: "Doha",      email: "ops@dohalogistics.example",      notes: "Customs clearance and last-mile to site." },
];

// Category / sub-category are CODES (0100); the tree below gives them names.
const PRODUCT_CATEGORIES = [
  { code: "REBAR",        name: "Reinforcement bars",   subs: [{ code: "B500B_12MM", name: "B500B 12 mm" }, { code: "B500B_16MM", name: "B500B 16 mm" }, { code: "B500B_20MM", name: "B500B 20 mm" }, { code: "B500B_25MM", name: "B500B 25 mm" }, { code: "B500B_32MM", name: "B500B 32 mm" }] },
  { code: "DOWEL_BARS",   name: "Dowel bars",           subs: [{ code: "D20_PLAIN", name: "20 mm plain" }, { code: "D25_EPOXY", name: "25 mm epoxy coated" }, { code: "D20_SS316", name: "20 mm SS316" }, { code: "D32_EPOXY", name: "32 mm epoxy coated" }] },
  { code: "BEARINGS",     name: "Bridge bearings",      subs: [{ code: "PTFE", name: "PTFE sliding" }, { code: "ELASTOMERIC", name: "Elastomeric" }, { code: "CUSTOM", name: "Custom / engineered" }] },
  { code: "FASTENERS",    name: "Fasteners & anchors",  subs: [{ code: "ANCHOR_BOLTS", name: "Anchor bolts" }, { code: "CHEMICAL_ANCHORS", name: "Chemical anchors" }, { code: "HEX_BOLTS", name: "Hex bolts" }] },
  { code: "SAFETY_GEAR",  name: "Safety gear (PPE)",    subs: [{ code: "HEAD", name: "Head protection" }, { code: "BODY", name: "Body & hi-vis" }, { code: "FALL", name: "Fall protection" }] },
  { code: "BIRD_CONTROL", name: "Bird control",         subs: [{ code: "SPIKES", name: "Spikes" }] },
];

// Prices in QAR. cost_price_as_of drives the cost-based source ladder
// (PRODUCT_COST is trusted for 30 days): 0 = fresh ERP cost, 95 = stale, so
// pricing that line asks for an RFQ. A cost_sheet marks a MADE part priced
// from the cost model's own rates instead of a bought-in cost.
const PRODUCTS = [
  { ref: "PRD-0001", name: "Rebar B500B 12 mm",                    sku: "RB-B500B-12",    category: "REBAR",        sub: "B500B_12MM",       uom: "Ton", list: 2750,  cost: 2410,  asOf: 0,  breaks: [{ from: 50, rate: 2700 }, { from: 200, rate: 2650 }], description: "High-yield deformed bar, B500B, 12 m lengths, mill certificate per heat" },
  { ref: "PRD-0002", name: "Rebar B500B 16 mm",                    sku: "RB-B500B-16",    category: "REBAR",        sub: "B500B_16MM",       uom: "Ton", list: 2720,  cost: 2395,  asOf: 0,  breaks: [{ from: 50, rate: 2680 }, { from: 200, rate: 2630 }], description: "High-yield deformed bar, B500B, 12 m lengths" },
  { ref: "PRD-0003", name: "Rebar B500B 20 mm",                    sku: "RB-B500B-20",    category: "REBAR",        sub: "B500B_20MM",       uom: "Ton", list: 2700,  cost: 2380,  asOf: 0,  breaks: null, description: "High-yield deformed bar, B500B, 12 m lengths" },
  { ref: "PRD-0004", name: "Rebar B500B 25 mm",                    sku: "RB-B500B-25",    category: "REBAR",        sub: "B500B_25MM",       uom: "Ton", list: 2700,  cost: 2380,  asOf: 0,  breaks: null, description: "High-yield deformed bar, B500B, 12 m lengths" },
  { ref: "PRD-0005", name: "Rebar B500B 32 mm",                    sku: "RB-B500B-32",    category: "REBAR",        sub: "B500B_32MM",       uom: "Ton", list: 2760,  cost: 2430,  asOf: 0,  breaks: null, description: "High-yield deformed bar, B500B, 12 m lengths. No negotiated mill rate -- prices from the steel index formula" },
  { ref: "PRD-0006", name: "Dowel bar 20 x 450 mm plain",          sku: "DB-20-450-PL",   category: "DOWEL_BARS",   sub: "D20_PLAIN",        uom: "Nos", list: 12.5,  cost: 9.4,   asOf: 0,  breaks: [{ from: 5000, rate: 11.9 }, { from: 20000, rate: 11.2 }], description: "Plain round dowel, S355, sawn ends, one end debonded" },
  { ref: "PRD-0007", name: "Dowel bar 25 x 500 mm epoxy coated",   sku: "DB-25-500-EP",   category: "DOWEL_BARS",   sub: "D25_EPOXY",        uom: "Nos", list: 42,    cost: 31.5,  asOf: 0,  breaks: [{ from: 5000, rate: 39.5 }, { from: 20000, rate: 37 }], description: "Fusion-bonded epoxy coated dowel to ASTM A775, with end caps" },
  { ref: "PRD-0008", name: "Dowel bar 20 x 450 mm SS316",          sku: "DB-20-450-SS",   category: "DOWEL_BARS",   sub: "D20_SS316",        uom: "Nos", list: 155,   cost: 118,   asOf: 0,  breaks: null, description: "Stainless steel 316 dowel for marine and chloride exposure" },
  { ref: "PRD-0009", name: "Dowel bar 32 x 600 mm epoxy coated",   sku: "DB-32-600-EP",   category: "DOWEL_BARS",   sub: "D32_EPOXY",        uom: "Nos", list: 78,    cost: 58,    asOf: 0,  breaks: null, description: "Epoxy coated dowel, heavy-duty pavement joints. No negotiated rate -- prices from the list-price formula" },
  { ref: "PRD-0010", name: "PTFE sliding bearing 500 kN",          sku: "BR-PTFE-500",    category: "BEARINGS",     sub: "PTFE",             uom: "Nos", list: 4850,  cost: 3600,  asOf: 0,  breaks: null, description: "Free-sliding PTFE/stainless bearing, 500 kN vertical, EN 1337-2" },
  { ref: "PRD-0011", name: "PTFE sliding bearing 1000 kN",         sku: "BR-PTFE-1000",   category: "BEARINGS",     sub: "PTFE",             uom: "Nos", list: 8900,  cost: 6700,  asOf: 95, breaks: null, description: "Free-sliding PTFE/stainless bearing, 1000 kN vertical, EN 1337-2. ERP cost is 95 days old -- pricing this line asks the supplier for an RFQ" },
  { ref: "PRD-0012", name: "Elastomeric bearing 300 x 400 x 52 mm", sku: "BR-ELA-300400",  category: "BEARINGS",     sub: "ELASTOMERIC",      uom: "Nos", list: 1250,  cost: 880,   asOf: 0,  breaks: null, description: "Laminated elastomeric bearing, EN 1337-3, steel-reinforced" },
  { ref: "PRD-0013", name: "Custom PTFE guided bearing (engineered)", sku: "BR-PTFE-CUSTOM", category: "BEARINGS",   sub: "CUSTOM",           uom: "Nos", list: 12500, cost: null,  asOf: null, breaks: null, description: "Guided PTFE bearing built to the consultant's drawing. MADE part: material + labour from the cost model", costSheet: [{ path: "material.rate_per_unit", qty: 85 }, { path: "labour.rate_per_hour", qty: 14 }] },
  { ref: "PRD-0014", name: "Anchor bolt M20 x 300 HDG",            sku: "FA-AB-M20-300",  category: "FASTENERS",    sub: "ANCHOR_BOLTS",     uom: "Nos", list: 18.5,  cost: 12.8,  asOf: 0,  breaks: [{ from: 2000, rate: 17.6 }], description: "Hot-dip galvanised L-type anchor bolt, grade 8.8, nut + washer" },
  { ref: "PRD-0015", name: "Chemical anchor 410 ml",               sku: "FA-CA-410",      category: "FASTENERS",    sub: "CHEMICAL_ANCHORS", uom: "Nos", list: 68,    cost: 47,    asOf: 0,  breaks: null, description: "Vinylester injection anchor, ETA-approved, 410 ml cartridge" },
  { ref: "PRD-0016", name: "Safety helmet EN 397 (vented)",        sku: "SG-HLM-EN397",   category: "SAFETY_GEAR",  sub: "HEAD",             uom: "Nos", list: 28,    cost: 17.5,  asOf: 0,  breaks: [{ from: 500, rate: 26 }], description: "ABS shell, ratchet harness, vented, EN 397" },
  { ref: "PRD-0017", name: "Full-body safety harness EN 361",      sku: "SG-HAR-EN361",   category: "SAFETY_GEAR",  sub: "FALL",             uom: "Nos", list: 165,   cost: 108,   asOf: 0,  breaks: null, description: "Two-point full-body harness with dorsal D-ring, EN 361" },
  { ref: "PRD-0018", name: "Stainless bird spike strip 1 m",       sku: "BC-SPK-1M",      category: "BIRD_CONTROL", sub: "SPIKES",           uom: "Mtr", list: 24,    cost: 15.2,  asOf: 0,  breaks: null, description: "SS304 spikes on polycarbonate base, 1 m strip" },
];

// Deals (0120). amount follows the latest linked quote's subtotal (§4.4).
const DEALS = [
  { ref: "OPP-0001", account: "ACC-0001", contact: "CON-0001", title: "North Field East — Package 3 rebar & dowels",     description: "BOQ for the LNG train foundations: B500B rebar by the tonne plus epoxy dowels for the pavement joints.", stage: "negotiate", outcome: "open", loss_reason: null, expected_close: 21,  amount: 810200,  probability: 75,  source: "direct",   competitor: "Local stockist",   age: 34 },
  { ref: "OPP-0002", account: "ACC-0002", contact: "CON-0003", title: "Al Khor Expressway — bridge bearings (P2)",       description: "Bearings for two interchanges; consultant wants PTFE on the mainline, elastomeric on the ramps.", stage: "propose",   outcome: "open", loss_reason: null, expected_close: 45,  amount: 390500,  probability: 50,  source: "referral", competitor: null,               age: 18 },
  { ref: "OPP-0003", account: "ACC-0003", contact: "CON-0005", title: "Lusail Tower 3 — anchors & fasteners",           description: "Anchor bolts and chemical anchors for the podium steelwork, plus site PPE.",                 stage: "won",       outcome: "won",  loss_reason: null, expected_close: -6,  amount: 93960,   probability: 100, source: "direct",   competitor: null,               age: 60 },
  { ref: "OPP-0004", account: "ACC-0006", contact: "CON-0008", title: "Site PPE annual supply",                          description: "Helmets, harnesses and bird spikes for the yard. Lost on price to a Sharjah trader.",         stage: "lost",      outcome: "lost", loss_reason: "price", expected_close: -12, amount: 26150, probability: 0,  source: "lead",     competitor: "Sharjah trader",   age: 50 },
  { ref: "OPP-0005", account: "ACC-0008", contact: "CON-0010", title: "Metro Package 4 — dowel bars, 6 stations",       description: "Tender expected Q4. Volume pricing on 25 mm epoxy dowels; SS316 for the two coastal stations.", stage: "qualify",   outcome: "open", loss_reason: null, expected_close: 90,  amount: 1240000, probability: 20,  source: "direct",   competitor: null,               age: 5 },
  { ref: "OPP-0006", account: "ACC-0005", contact: "CON-0007", title: "Ras Laffan tank farm — SS dowels",               description: "SS316 dowels for the containment slab joints; heavy-duty epoxy dowels for the access road.",   stage: "propose",   outcome: "open", loss_reason: null, expected_close: 30,  amount: 187600,  probability: 50,  source: "direct",   competitor: null,               age: 12 },
];

// Standard Quotes. A line with `breaks` gets quantity-break OFFER rows under
// it (printed, never charged -- lineTotals.ts); `group` puts a line in an
// alternative option group (only the chosen group's lines count).
const QUOTES = [
  {
    ref: "SQ-2026-0001", account: "ACC-0001", contact: "CON-0001", deal: "OPP-0001", status: "sent", age: 25, sentAge: 20, closedAge: null, validDays: 10, inquiryAge: 28,
    intro: "Further to your BOQ for North Field East Package 3, we are pleased to quote as follows. Rebar is offered ex-mill Jebel Ali with test certificates per heat; dowels include end caps.",
    terms: "Delivery 3-4 weeks from PO for rebar, 6-8 weeks for dowels. Payment 30 days. Prices valid for 10 days (steel index).",
    shipping: 1800,
    lines: [
      { product: "PRD-0002", description: "Rebar B500B 16 mm, 12 m lengths, mill certificates per heat", uom: "Ton", qty: 120,  rate: 2690 },
      { product: "PRD-0004", description: "Rebar B500B 25 mm, 12 m lengths",                            uom: "Ton", qty: 80,   rate: 2680 },
      { product: "PRD-0007", description: "Dowel bar 25 x 500 mm epoxy coated with end caps",           uom: "Nos", qty: 6000, rate: 41,   breaks: [{ qty: 10000, rate: 39.5 }, { qty: 20000, rate: 37 }] },
      { product: "PRD-0014", description: "Anchor bolt M20 x 300 HDG c/w nut and washer",               uom: "Nos", qty: 1500, rate: 18 },
    ],
  },
  {
    ref: "SQ-2026-0002", account: "ACC-0002", contact: "CON-0003", deal: "OPP-0002", status: "draft", age: 10, sentAge: null, closedAge: null, validDays: 30, inquiryAge: 14,
    intro: "Bearings for the Al Khor Expressway interchanges P2, per the consultant's bearing schedule rev. C. Dowels for the expansion joints are offered as two options.",
    terms: "Delivery 10-12 weeks ex-works Antwerp. Payment 30 % with order, balance against shipping documents.",
    shipping: 2500,
    lines: [
      { product: "PRD-0010", description: "PTFE sliding bearing 500 kN, EN 1337-2, free-sliding",       uom: "Nos", qty: 24,   rate: 4750 },
      { product: "PRD-0011", description: "PTFE sliding bearing 1000 kN, EN 1337-2, free-sliding",      uom: "Nos", qty: 12,   rate: 8700 },
      { product: "PRD-0012", description: "Elastomeric bearing 300 x 400 x 52 mm, EN 1337-3",           uom: "Nos", qty: 40,   rate: 1190 },
      { product: "PRD-0007", description: "Dowel bar 25 x 500 mm epoxy coated (expansion joints)",      uom: "Nos", qty: 3000, rate: 41.5, group: { id: "opt-epoxy", label: "Option A — epoxy coated dowels", chosen: true } },
      { product: "PRD-0008", description: "Dowel bar 20 x 450 mm SS316 (expansion joints)",             uom: "Nos", qty: 3000, rate: 152,  group: { id: "opt-ss316", label: "Option B — SS316 dowels", chosen: false } },
    ],
  },
  {
    ref: "SQ-2026-0003", account: "ACC-0003", contact: "CON-0005", deal: "OPP-0003", status: "accepted", age: 45, sentAge: 40, closedAge: 6, validDays: -20, inquiryAge: 48,
    intro: "Anchors and fasteners for the Lusail Tower 3 podium steelwork, with site PPE as requested.",
    terms: "Ex-stock Doha. Payment 30 days.",
    shipping: 340,
    lines: [
      { product: "PRD-0014", description: "Anchor bolt M20 x 300 HDG c/w nut and washer",               uom: "Nos", qty: 3200, rate: 17.8 },
      { product: "PRD-0015", description: "Chemical anchor 410 ml, vinylester",                          uom: "Nos", qty: 480,  rate: 64 },
      { product: "PRD-0016", description: "Safety helmet EN 397, vented, white",                         uom: "Nos", qty: 120,  rate: 26.5 },
      { product: "PRD-0017", description: "Full-body safety harness EN 361",                             uom: "Nos", qty: 20,   rate: 155 },
    ],
  },
  {
    ref: "SQ-2026-0004", account: "ACC-0006", contact: "CON-0008", deal: "OPP-0004", status: "rejected", age: 40, sentAge: 38, closedAge: 12, validDays: -15, inquiryAge: 42,
    intro: "PPE and bird control for the Al Wakrah yard, as discussed.",
    terms: "Ex-stock Doha. Payment 30 days.",
    shipping: 0,
    lines: [
      { product: "PRD-0016", description: "Safety helmet EN 397, vented, white",                         uom: "Nos", qty: 400, rate: 27 },
      { product: "PRD-0017", description: "Full-body safety harness EN 361",                             uom: "Nos", qty: 60,  rate: 160 },
      { product: "PRD-0018", description: "Stainless bird spike strip 1 m",                              uom: "Mtr", qty: 250, rate: 23 },
    ],
  },
  {
    ref: "SQ-2026-0005", account: "ACC-0005", contact: "CON-0007", deal: "OPP-0006", status: "draft", age: 3, sentAge: null, closedAge: null, validDays: 14, inquiryAge: 5,
    intro: "SS316 dowels for the containment slab joints and heavy-duty epoxy dowels for the access road, per your enquiry.",
    terms: "Delivery to Ras Laffan gate; gate passes by the customer. Payment 30 days.",
    shipping: 0,
    lines: [
      { product: "PRD-0008", description: "Dowel bar 20 x 450 mm SS316, marine grade",                    uom: "Nos", qty: 1200, rate: 150 },
      { product: "PRD-0009", description: "Dowel bar 32 x 600 mm epoxy coated, heavy-duty pavement joints", uom: "Nos", qty: 100, rate: 76 },
    ],
  },
];

// ── Price Books ──────────────────────────────────────────────────────────
// Row shapes mirror src/lib/pricing/wizard.ts templates exactly (that is what
// the Setup wizard would write); the tenant's own numbers are in RULES.
const comp = (code, name, cls, calc_type, calc_basis, sign, manual_override, extra = {}) =>
  ({ code, name, class: cls, calc_type, calc_basis, sign, manual_override, is_statistical: false, resolution_strategy: "MOST_SPECIFIC", rounding_rule: null, ...extra });
const TAX_ROUNDING = { rounding_rule: { precision: 2, mode: "HALF_UP" } };

const DIMENSIONS = [
  { attribute: "customer.tier",        weight: 30, label: "Customer tier" },
  { attribute: "region",               weight: 20, label: "Region" },
  { attribute: "document_type",        weight: 15, label: "Document type" },
  { attribute: "product.category",     weight: 50, label: "Product family" },
  { attribute: "product.sub_category", weight: 30, label: "Size / spec" },
];

const COST_BASED_SOURCES = [
  { code: "PRODUCT_COST", label: "ERP cost price on the product", tier: 1, quality: "actual",    max_age_days: 30,  requirement: null },
  { code: "RFQ",          label: "Supplier RFQ reply",             tier: 2, quality: "confirmed", max_age_days: 180, requirement: null },
  { code: "PRICE_LIST",   label: "Imported cost price list",       tier: 3, quality: "list",      max_age_days: 365, requirement: null },
  { code: "MANUAL",       label: "Rate kept by hand in the cost model", tier: 4, quality: "estimate", max_age_days: null, requirement: null },
];

const BOOKS = [
  {
    area: "default",
    notes: "Big Blue — Cost-based (landed cost + margin). Seeded 2026-09-07.",
    components: [
      comp("PURCHASE_COST",  "Bought-in cost",            "COST_BUILDUP", "COST_ROLLUP",  "COST_REF",     "POSITIVE", "FORBIDDEN"),
      comp("MATERIAL_COST",  "Material cost",             "COST_BUILDUP", "COST_ROLLUP",  "COST_REF",     "POSITIVE", "FORBIDDEN"),
      comp("LABOUR_COST",    "Labour cost",               "COST_BUILDUP", "COST_ROLLUP",  "COST_REF",     "POSITIVE", "FORBIDDEN"),
      comp("SALVAGE_CREDIT", "Salvage credit",            "COST_BUILDUP", "COST_ROLLUP",  "COST_REF",     "NEGATIVE", "FORBIDDEN"),
      comp("FREIGHT",        "Freight",                   "FREIGHT",      "PERCENT",      "SUBTOTAL_REF", "POSITIVE", "ALLOWED_WITH_REASON"),
      comp("HANDLING",       "Handling",                  "SURCHARGE",    "PERCENT",      "SUBTOTAL_REF", "POSITIVE", "ALLOWED_WITH_REASON"),
      comp("MARGIN_MARKUP",  "Margin",                    "MARKUP",       "PERCENT",      "SUBTOTAL_REF", "POSITIVE", "ALLOWED_WITH_REASON"),
      comp("CUST_DISC",      "Customer discount",         "DISCOUNT",     "PERCENT",      "NET_SO_FAR",   "NEGATIVE", "ALLOWED_WITH_REASON"),
      comp("MARGIN_FLOOR",   "Minimum acceptable margin", "STATISTICAL",  "FIXED_AMOUNT", "GROSS",        "POSITIVE", "FORBIDDEN", { is_statistical: true }),
      comp("TAX",            "Tax",                       "TAX",          "PERCENT",      "SUBTOTAL_REF", "POSITIVE", "FORBIDDEN", TAX_ROUNDING),
    ],
    procedure: {
      code: "COST_SIMULATOR", name: "Cost-based", entry_mode: "COST_UP",
      steps: [
        { step: 10, component: "PURCHASE_COST", cost_model: "STANDARD_COST", rollup_kind: "PURCHASE" },
        { step: 20, component: "MATERIAL_COST", cost_model: "STANDARD_COST", rollup_kind: "MATERIAL" },
        { step: 30, component: "LABOUR_COST", cost_model: "STANDARD_COST", rollup_kind: "LABOUR" },
        { step: 40, component: "SALVAGE_CREDIT", cost_model: "STANDARD_COST", rollup_kind: "SALVAGE_CREDIT" },
        { step: 50, subtotal: "TOTAL_COST" },
        { step: 60, component: "FREIGHT", calc_basis_ref: "TOTAL_COST" },
        { step: 70, component: "HANDLING", calc_basis_ref: "TOTAL_COST" },
        { step: 80, subtotal: "LANDED_COST" },
        { step: 90, component: "MARGIN_MARKUP", calc_basis_ref: "LANDED_COST" },
        { step: 100, subtotal: "NET_1" },
        { step: 105, component: "MARGIN_FLOOR", statistical: true, guardrail: { kind: "MARGIN_FLOOR", cost_subtotal: "LANDED_COST", revenue_subtotal: "NET_1", policy: "block" } },
        { step: 110, component: "CUST_DISC" },
        { step: 120, subtotal: "NET_2" },
        { step: 130, component: "TAX", calc_basis_ref: "NET_2" },
        { step: 140, subtotal: "FINAL" },
      ],
    },
    costModel: { code: "STANDARD_COST", name: "Standard cost", sources: COST_BASED_SOURCES },
    costInputs: [
      { path: "material.rate_per_unit",  kind: "MATERIAL",       value: 62,  uom: "Kg", currency: "QAR" },
      { path: "labour.rate_per_hour",    kind: "LABOUR",         value: 95,  uom: "Hr", currency: "QAR" },
      { path: "salvage.credit_per_unit", kind: "SALVAGE_CREDIT", value: 0,   uom: "Kg", currency: "QAR" },
    ],
    rules: [
      { component: "FREIGHT",       match: {},                              value: 3 },
      { component: "FREIGHT",       match: { region: "Ras Laffan" },        value: 6 },
      { component: "FREIGHT",       match: { region: "Al Wakrah" },         value: 4 },
      { component: "HANDLING",      match: {},                              value: 1.5 },
      { component: "MARGIN_MARKUP", match: {},                              value: 22 },
      { component: "MARGIN_MARKUP", match: { "customer.tier": "direct" },   value: 18 },
      { component: "MARGIN_MARKUP", match: { "customer.tier": "prospect" }, value: 25 },
      { component: "CUST_DISC",     match: {},                              value: 0 },
      { component: "MARGIN_FLOOR",  match: {},                              value: 12 },
      { component: "TAX",           match: {},                              value: 0 },
    ],
  },
  {
    area: "steel_catalog",
    notes: "Big Blue — Catalog + Formula for rebar and dowel bars. Seeded 2026-09-07.",
    components: [
      comp("MATERIAL_RATE", "Rate per unit",             "PRICE",       "FORMULA",      "CUSTOM_METRIC", "POSITIVE", "ALLOWED_WITH_REASON"),
      comp("FREIGHT",       "Freight",                   "FREIGHT",     "FIXED_AMOUNT", "NET_SO_FAR",    "POSITIVE", "ALLOWED_WITH_REASON"),
      comp("MARGIN_MARKUP", "Margin",                    "MARKUP",      "PERCENT",      "SUBTOTAL_REF",  "POSITIVE", "ALLOWED_WITH_REASON"),
      comp("MARGIN_FLOOR",  "Minimum acceptable margin", "STATISTICAL", "FIXED_AMOUNT", "GROSS",         "POSITIVE", "FORBIDDEN", { is_statistical: true }),
      comp("CUST_DISC",     "Customer discount",         "DISCOUNT",    "PERCENT",      "NET_SO_FAR",    "NEGATIVE", "ALLOWED_WITH_REASON"),
      comp("TAX",           "Tax",                       "TAX",         "PERCENT",      "SUBTOTAL_REF",  "POSITIVE", "FORBIDDEN", TAX_ROUNDING),
    ],
    procedure: {
      code: "CATALOG_FORMULA", name: "Catalog + Formula", entry_mode: "LIST_DOWN",
      steps: [
        { step: 10, component: "MATERIAL_RATE", required: true },
        { step: 20, subtotal: "TOTAL_COST" },
        { step: 30, component: "FREIGHT" },
        { step: 40, subtotal: "LANDED_COST" },
        { step: 50, component: "MARGIN_MARKUP", calc_basis_ref: "LANDED_COST" },
        { step: 60, subtotal: "NET_1" },
        { step: 65, component: "MARGIN_FLOOR", statistical: true, guardrail: { kind: "MARGIN_FLOOR", cost_subtotal: "LANDED_COST", revenue_subtotal: "NET_1", policy: "block" } },
        { step: 70, component: "CUST_DISC" },
        { step: 80, subtotal: "NET_2" },
        { step: 90, component: "TAX", calc_basis_ref: "NET_2" },
        { step: 100, subtotal: "FINAL" },
      ],
    },
    costModel: { code: "CATALOG_FALLBACK_COST", name: "Fallback cost inputs", sources: [] },
    costInputs: [
      // Steel index, QAR per tonne -- what an un-negotiated rebar size costs.
      { path: "material.rate_per_unit",    kind: "MATERIAL", value: 2350, uom: "Ton", currency: "QAR" },
      // Estimated mill cost as a share of the catalogue list price, for a
      // dowel spec with no negotiated rate.
      { path: "dowel.cost_ratio_of_list",  kind: "INDEX",    value: 0.82, uom: null,  currency: null },
    ],
    rules: [
      // Negotiated mill rates per spec (QAR per tonne / per piece). A flat
      // rate on a FORMULA component is "<rate> * ctx.line.quantity" -- the
      // wizard's flatRateFormula(); the engine never reads .value there.
      { component: "MATERIAL_RATE", match: { "product.category": "REBAR", "product.sub_category": "B500B_12MM" }, formula: "2410 * ctx.line.quantity", uom: "Ton" },
      { component: "MATERIAL_RATE", match: { "product.category": "REBAR", "product.sub_category": "B500B_16MM" }, formula: "2395 * ctx.line.quantity", uom: "Ton" },
      { component: "MATERIAL_RATE", match: { "product.category": "REBAR", "product.sub_category": "B500B_20MM" }, formula: "2380 * ctx.line.quantity", uom: "Ton" },
      { component: "MATERIAL_RATE", match: { "product.category": "REBAR", "product.sub_category": "B500B_25MM" }, formula: "2380 * ctx.line.quantity", uom: "Ton" },
      { component: "MATERIAL_RATE", match: { "product.category": "DOWEL_BARS", "product.sub_category": "D20_PLAIN" }, formula: "9.40 * ctx.line.quantity", uom: "Nos" },
      { component: "MATERIAL_RATE", match: { "product.category": "DOWEL_BARS", "product.sub_category": "D25_EPOXY" }, formula: "31.50 * ctx.line.quantity", uom: "Nos" },
      { component: "MATERIAL_RATE", match: { "product.category": "DOWEL_BARS", "product.sub_category": "D20_SS316" }, formula: "118 * ctx.line.quantity", uom: "Nos" },
      // Family-level fallbacks: any rebar size not listed above prices from
      // the steel index; any dowel spec not listed prices from its own list
      // price. Most-specific-wins means these only fire when no spec row matches.
      { component: "MATERIAL_RATE", match: { "product.category": "REBAR" },      formula: "ctx.cost.material.rate_per_unit * ctx.line.quantity" },
      { component: "MATERIAL_RATE", match: { "product.category": "DOWEL_BARS" }, formula: "ctx.line.product.list_price * ctx.cost.dowel.cost_ratio_of_list * ctx.line.quantity" },
      { component: "FREIGHT",       match: {},                              value: 350 },
      { component: "FREIGHT",       match: { region: "Ras Laffan" },        value: 1200 },
      { component: "MARGIN_MARKUP", match: {},                              value: 14 },
      { component: "MARGIN_MARKUP", match: { "customer.tier": "direct" },   value: 11 },
      { component: "MARGIN_FLOOR",  match: {},                              value: 8 },
      { component: "CUST_DISC",     match: {},                              value: 0 },
      { component: "CUST_DISC",     match: { "customer.tier": "direct" },   value: 1.5 },
      { component: "TAX",           match: {},                              value: 0 },
    ],
  },
];

const ROUTING = {
  rules: [
    { attribute: "product.category", value: "REBAR",      area: "steel_catalog" },
    { attribute: "product.category", value: "DOWEL_BARS", area: "steel_catalog" },
  ],
  default_area: "default",
};

// ── Cleanup ──────────────────────────────────────────────────────────────
async function cleanup() {
  console.log(`\nCleanup: removing every sample row in tenant "${tenant.slug}" …`);
  // Dependency order: documents/RFQs that point at quotes and products first,
  // quotes before accounts (standard_quotes.account_id is ON DELETE RESTRICT),
  // pricing content before its version rows.
  const TABLES = [
    "pricing_documents", "pricing_usage", "pricing_rfqs",
    "standard_quote_attachments", "standard_quote_lines", "standard_quotes",
    "opportunity_lines", "opportunities",
    "contacts", "accounts", "products", "suppliers",
    "pricing_rules", "pricing_components", "pricing_procedures", "pricing_cost_inputs", "pricing_cost_models",
    "pricing_config_versions", "pricing_dimensions",
  ];
  for (const table of TABLES) {
    const { count, error: countErr } = await sb.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", T);
    if (countErr) { if (missingTable(countErr)) { console.log(`  – ${table}: table not present, skipped`); continue; } die(`${table} count: ${countErr.message}`); }
    if (!count) { console.log(`  – ${table}: nothing to delete`); continue; }
    const { error } = await sb.from(table).delete().eq("tenant_id", T);
    if (error) die(`${table} delete: ${error.message}`);
    ok(`${table}: ${count} row(s) removed`);
  }
  // The routing rules point at the steel_catalog book that no longer exists;
  // leaving them would send every rebar line to a missing Price Book.
  const config = { ...(tenant.config ?? {}) };
  if (config.pricing?.routing) {
    const { routing: _r, ...pricing } = config.pricing;
    config.pricing = pricing;
    unwrap(await sb.from("tenants").update({ config }).eq("id", T), "config update");
    ok("config.pricing.routing removed");
  }
  console.log("\nDone. Feature flags, category tree, company info and users were left as they are.\n");
}

if (CLEANUP) { await cleanup(); process.exit(0); }

// ── Seed ─────────────────────────────────────────────────────────────────
console.log("\n1. Features and config");
{
  const features = {
    ...(tenant.features ?? {}),
    accounts: true, contacts: true, suppliers: true, products: true, standard_quotes: true,
    pipeline: true, pricing_engine: true, pricing_engine_quotes: true,
    reports: true, data_workbench: true, administration: true,
  };
  const config = { ...(tenant.config ?? {}) };
  config.product_categories = PRODUCT_CATEGORIES;
  config.wfm = { ...(config.wfm ?? {}), timezone: "Asia/Qatar" };
  config.tax = config.tax ?? { label: "VAT", rate: 0, inclusive: false };
  // Qatari riyal everywhere (src/lib/currency.ts) -- the seeded figures are QAR.
  config.currency = "QAR";
  // Nothing here has a real address, but the moment someone types one in,
  // an email demo must not reach a stranger -- redirect to the owner's inbox
  // (Settings → General → Email output can switch it later).
  config.email_output = config.email_output ?? { mode: "redirect", redirect_to: "sap.rashid@gmail.com" };
  config.pricing = { ...(config.pricing ?? {}), routing: ROUTING };
  // Letterhead for the quote PDF: only the keys the owner has not filled in.
  const company_info = {
    name: "Big Blue Engineering Solutions W.L.L.",
    tagline: "Engineered products for infrastructure — rebar, dowel bars, bearings, fasteners",
    address: "Building 27, Street 45, Industrial Area, Doha, Qatar",
    email: "sales@bigblue.example",
    web: "bigblue.example",
    phones: [{ label: "Sales", number: "+974 4000 0000" }],
    footer_tagline: "Supplying Qatar's contractors since 2009",
    ...(tenant.company_info ?? {}),
  };
  unwrap(await sb.from("tenants").update({ features, config, company_info }).eq("id", T), "tenant update");
  ok("flags on: products, standard_quotes, pipeline, pricing_engine(+quotes), suppliers, accounts, contacts");
  ok("config: currency QAR, 6 product families, Asia/Qatar, VAT 0, email redirect, Price Book routing; company_info filled where empty");
}

console.log("2. Accounts");
const accountIds = {};
{
  const existing = unwrap(await sb.from("accounts").select("id, ref, name").eq("tenant_id", T), "accounts read");
  for (const a of ACCOUNTS) {
    const found = existing.find((e) => e.ref === a.ref || e.name === a.name);
    if (found) { accountIds[a.ref] = found.id; continue; }
    const row = unwrap(await sb.from("accounts").insert({
      tenant_id: T, ref: a.ref, name: a.name, type: a.type, city: a.city, state: a.state, country: "Qatar",
      industry: a.industry, employee_count: a.employee_count, website: a.website, address_line1: a.address_line1, notes: a.notes,
      phone: null, email: null, marketing_opt_out: false,
    }).select("id").single(), `account ${a.ref}`);
    accountIds[a.ref] = row.id;
  }
  ok(`${ACCOUNTS.length} accounts (${existing.length} were already there)`);
}

console.log("3. Contacts");
const contactIds = {};
{
  const existing = unwrap(await sb.from("contacts").select("id, ref, name").eq("tenant_id", T), "contacts read");
  for (const c of CONTACTS) {
    const found = existing.find((e) => e.ref === c.ref || e.name === c.name);
    if (found) { contactIds[c.ref] = found.id; continue; }
    const row = unwrap(await sb.from("contacts").insert({
      tenant_id: T, ref: c.ref, account_id: accountIds[c.account], name: c.name, role: c.role, department: c.department,
      phone: null, email: null, country: "Qatar",
    }).select("id").single(), `contact ${c.ref}`);
    contactIds[c.ref] = row.id;
  }
  ok(`${CONTACTS.length} contacts`);
}

console.log("4. Suppliers");
{
  const existing = unwrap(await sb.from("suppliers").select("id, ref, name").eq("tenant_id", T), "suppliers read");
  let added = 0;
  for (const s of SUPPLIERS) {
    if (existing.some((e) => e.ref === s.ref || e.name === s.name)) continue;
    unwrap(await sb.from("suppliers").insert({ tenant_id: T, ref: s.ref, name: s.name, type: s.type, city: s.city, email: s.email, phone: null, notes: s.notes, status: "active" }), `supplier ${s.ref}`);
    added++;
  }
  ok(`${SUPPLIERS.length} suppliers (${added} added)`);
}

console.log("5. Products");
const productIds = {};
{
  const existing = unwrap(await sb.from("products").select("id, ref, name").eq("tenant_id", T), "products read");
  for (const p of PRODUCTS) {
    const found = existing.find((e) => e.ref === p.ref || e.name === p.name);
    if (found) { productIds[p.ref] = found.id; continue; }
    const row = unwrap(await sb.from("products").insert({
      tenant_id: T, ref: p.ref, name: p.name, sku: p.sku, category: p.category, sub_category: p.sub, uom: p.uom,
      description: p.description, list_price: p.list, cost_price: p.cost,
      cost_price_as_of: p.asOf === null ? null : dateOffset(-p.asOf),
      cost_sheet: p.costSheet ?? null, qty_breaks: p.breaks, tax_percent: 0, status: "active",
    }).select("id").single(), `product ${p.ref}`);
    productIds[p.ref] = row.id;
  }
  ok(`${PRODUCTS.length} products`);
}

console.log("6. Price Books");
{
  for (const d of DIMENSIONS) {
    unwrap(await sb.from("pricing_dimensions").upsert({ tenant_id: T, ...d }, { onConflict: "tenant_id,attribute" }), `dimension ${d.attribute}`);
  }
  for (const book of BOOKS) {
    const { data: versions } = await sb.from("pricing_config_versions").select("version, status").eq("tenant_id", T).eq("pricing_area", book.area);
    if (versions?.length) { ok(`${book.area}: already has ${versions.length} version(s), left untouched`); continue; }
    const version = 1;
    unwrap(await sb.from("pricing_config_versions").insert({
      tenant_id: T, pricing_area: book.area, version, status: "PUBLISHED", dsl_version: 1, notes: book.notes, published_at: new Date().toISOString(),
    }), `${book.area} version`);
    unwrap(await sb.from("pricing_components").insert(book.components.map((c) => ({ tenant_id: T, pricing_area: book.area, config_version: version, ...c }))), `${book.area} components`);
    unwrap(await sb.from("pricing_procedures").insert({ tenant_id: T, pricing_area: book.area, config_version: version, ...book.procedure }), `${book.area} procedure`);
    unwrap(await sb.from("pricing_cost_models").insert({ tenant_id: T, pricing_area: book.area, config_version: version, ...book.costModel }), `${book.area} cost model`);
    for (const i of book.costInputs) {
      const { data: have } = await sb.from("pricing_cost_inputs").select("id").eq("tenant_id", T).eq("cost_model_code", book.costModel.code).eq("path", i.path).is("product_id", null);
      if (have?.length) continue;
      unwrap(await sb.from("pricing_cost_inputs").insert({ tenant_id: T, cost_model_code: book.costModel.code, path: i.path, kind: i.kind, value: i.value, uom: i.uom, currency: i.currency, source: "MANUAL", source_code: "MANUAL", quality: "estimate", as_of: dateOffset(0) }), `${book.area} cost input ${i.path}`);
    }
    unwrap(await sb.from("pricing_rules").insert(book.rules.map((r) => ({
      tenant_id: T, pricing_area: book.area, config_version: version, component_code: r.component,
      match_attributes: r.match, value: r.value ?? null, formula: r.formula ?? null, uom: r.uom ?? null, currency: "QAR", origin: "MANUAL",
    }))), `${book.area} rules`);
    ok(`${book.area}: v1 PUBLISHED — ${book.components.length} components, ${book.rules.length} rules, ${book.costInputs.length} cost inputs`);
  }
}

console.log("7. Deals (pipeline)");
const dealIds = {};
{
  const { data: existing, error } = await sb.from("opportunities").select("id, ref, title").eq("tenant_id", T);
  if (error && missingTable(error)) {
    console.log("  – opportunities table not present (migration 0120 pending) — deals skipped, quotes will not be linked to deals");
  } else {
    if (error) die(`opportunities read: ${error.message}`);
    for (const d of DEALS) {
      const found = existing.find((e) => e.ref === d.ref || e.title === d.title);
      if (found) { dealIds[d.ref] = found.id; continue; }
      const closed = d.outcome !== "open";
      const row = unwrap(await sb.from("opportunities").insert({
        tenant_id: T, ref: d.ref, account_id: accountIds[d.account], contact_id: contactIds[d.contact], title: d.title, description: d.description,
        stage: d.stage, outcome: d.outcome, loss_reason: d.loss_reason, expected_close: dateOffset(d.expected_close),
        amount: d.amount, currency: "QAR", probability: d.probability, source: d.source, competitor: d.competitor, team: [],
        created_at: daysAgo(d.age), updated_at: daysAgo(Math.min(d.age, 2)), closed_at: closed ? dateOffset(d.expected_close) + "T10:00:00Z" : null,
      }).select("id").single(), `deal ${d.ref}`);
      dealIds[d.ref] = row.id;
    }
    ok(`${DEALS.length} deals`);
  }
}

console.log("8. Standard Quotes");
{
  const existing = unwrap(await sb.from("standard_quotes").select("id, ref").eq("tenant_id", T), "standard_quotes read");
  const hasDealColumn = Object.keys(dealIds).length > 0;
  for (const q of QUOTES) {
    if (existing.some((e) => e.ref === q.ref)) continue;
    // Charged lines: not a break offer, and not an unchosen alternative.
    const subtotal = q.lines.filter((l) => !l.group || l.group.chosen).reduce((s, l) => s + l.qty * l.rate, 0);
    const total = subtotal + q.shipping;
    const header = {
      tenant_id: T, ref: q.ref, account_id: accountIds[q.account], contact_id: contactIds[q.contact], status: q.status,
      valid_until: dateOffset(q.validDays), inquiry_date: dateOffset(-q.inquiryAge), intro_text: q.intro, terms: q.terms,
      header_discount_pct: 0, tax_pct: 0, shipping_amount: q.shipping, subtotal, total,
      created_at: daysAgo(q.age), updated_at: daysAgo(Math.min(q.age, 1)),
      sent_at: q.sentAge === null ? null : daysAgo(q.sentAge), closed_at: q.closedAge === null ? null : daysAgo(q.closedAge),
      ...(hasDealColumn && q.deal && dealIds[q.deal] ? { opportunity_id: dealIds[q.deal] } : {}),
    };
    let ins = await sb.from("standard_quotes").insert(header).select("id").single();
    if (ins.error && /opportunity_id/.test(ins.error.message)) {
      const { opportunity_id: _o, ...legacy } = header;
      ins = await sb.from("standard_quotes").insert(legacy).select("id").single();
    }
    const quote = unwrap(ins, `quote ${q.ref}`);
    let sl = 0;
    for (const l of q.lines) {
      sl++;
      const line = unwrap(await sb.from("standard_quote_lines").insert({
        tenant_id: T, standard_quote_id: quote.id, sl_no: String(sl), description: l.description, uom: l.uom,
        qty: l.qty, rate: l.rate, discount_pct: 0, amount: l.qty * l.rate, product_id: productIds[l.product],
        group_id: l.group?.id ?? null, group_label: l.group?.label ?? null, group_type: l.group ? "alternative" : null,
        is_selected: l.group ? l.group.chosen : true, show_on_pdf: true,
      }).select("id").single(), `${q.ref} line ${sl}`);
      for (const b of l.breaks ?? []) {
        unwrap(await sb.from("standard_quote_lines").insert({
          tenant_id: T, standard_quote_id: quote.id, sl_no: null, description: l.description, uom: l.uom,
          qty: b.qty, rate: b.rate, discount_pct: 0, amount: b.qty * b.rate, product_id: productIds[l.product],
          break_of: line.id, break_qty: b.qty, is_selected: true, show_on_pdf: true,
        }), `${q.ref} break ${b.qty}`);
      }
    }
  }
  ok(`${QUOTES.length} standard quotes (${existing.length} were already there)`);
}

console.log("\nSummary");
for (const table of ["accounts", "contacts", "suppliers", "products", "opportunities", "standard_quotes", "standard_quote_lines", "pricing_config_versions", "pricing_rules"]) {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", T);
  console.log(`  ${table.padEnd(24)} ${error ? (missingTable(error) ? "table not present" : error.message) : count}`);
}
console.log(`\nDone. Sign in at https://${tenant.custom_domain ?? "<tenant domain>"} — Pricing → Price Books shows "Default" and "Steel Catalog"; Sales → Standard Quotes shows SQ-2026-0001…0005.\n`);
