// Seed fixtures — the first slice runs on these until a Supabase project is
// wired. Modelled on Vikas Pioneers (Hosapete) per PROJECT.md §6.
// Stable string ids keep cross-references readable.

import type {
  Account, Contact, Site, Asset, Contract, Lead, Quote, QuoteLine,
  WorkOrder, Invoice, Technician, Activity,
} from "@/lib/types";

export const technicians: Technician[] = [
  { id: "tech_ramesh", name: "Ramesh", skills: "HT motor rewinding" },
  { id: "tech_suresh", name: "Suresh", skills: "Transformer oil testing" },
  { id: "tech_anil",   name: "Anil",   skills: "Pump & generator overhaul" },
  { id: "tech_farhan", name: "Farhan", skills: "Panel & onsite field service" },
];

export const accounts: Account[] = [
  // OEM / vendor partners — top of the funnel.
  { id: "acc_crompton",   name: "Crompton Greaves",        type: "oem", city: "Mumbai",   phone: "+91 22 5550 1100", email: "service@cromptongreaves.com", referred_by_account_id: null, created_at: "2026-01-12" },
  { id: "acc_marathon",   name: "Marathon Electric",       type: "oem", city: "Faridabad", phone: "+91 129 555 2200", email: "amc@marathon-electric.in",   referred_by_account_id: null, created_at: "2026-02-03" },
  { id: "acc_rotomotive", name: "Rotomotive Power Drives",  type: "oem", city: "Anand",    phone: "+91 269 255 3300", email: "support@rotomotive.com",    referred_by_account_id: null, created_at: "2026-02-20" },

  // Direct customers — walk-in / B2B, full margin.
  { id: "acc_krishna",   name: "Krishna Textiles",       type: "direct", city: "Hosapete", phone: "+91 8394 220 145", email: "works@krishnatextiles.in", referred_by_account_id: null, created_at: "2026-03-01" },
  { id: "acc_hpsteel",   name: "Hosapete Steel",         type: "direct", city: "Hosapete", phone: "+91 8394 220 700", email: "maint@hosapetesteel.com",  referred_by_account_id: null, created_at: "2026-03-18" },

  // End-customers serviced under an OEM referral / AMC.
  { id: "acc_sahyadri",  name: "Sahyadri Hospital",      type: "end_customer", city: "Hubli",   phone: "+91 836 555 8080", email: "facilities@sahyadri.org", referred_by_account_id: "acc_crompton",   created_at: "2026-04-02" },
  { id: "acc_bharat",    name: "Bharat Forge",           type: "end_customer", city: "Pune",    phone: "+91 20 5555 9090", email: "plant@bharatforge.com",   referred_by_account_id: "acc_marathon",   created_at: "2026-04-15" },
  { id: "acc_tata",      name: "Tata Motors",            type: "end_customer", city: "Dharwad", phone: "+91 836 555 7070", email: "upkeep@tatamotors.com",   referred_by_account_id: "acc_rotomotive", created_at: "2026-05-06" },
];

export const contacts: Contact[] = [
  { id: "con_krishna_1",  account_id: "acc_krishna",  name: "Mahesh Rao",     role: "Maintenance Head", phone: "+91 98860 11223", email: "mahesh@krishnatextiles.in" },
  { id: "con_sahyadri_1", account_id: "acc_sahyadri", name: "Dr. Nalini",     role: "Facilities Lead",  phone: "+91 99000 44556", email: "nalini@sahyadri.org" },
  { id: "con_bharat_1",   account_id: "acc_bharat",   name: "Sunil Kulkarni", role: "Plant Engineer",   phone: "+91 90110 77889", email: "sunil@bharatforge.com" },
  { id: "con_crompton_1", account_id: "acc_crompton", name: "Anita Desai",    role: "Service Manager",  phone: "+91 98200 33445", email: "anita@cromptongreaves.com" },
];

export const sites: Site[] = [
  { id: "site_krishna_1",  account_id: "acc_krishna",  label: "Spinning Unit",   address: "Plot 14, Industrial Area, Hosapete" },
  { id: "site_sahyadri_1", account_id: "acc_sahyadri", label: "Main Block",      address: "Vidyanagar, Hubli" },
  { id: "site_bharat_1",   account_id: "acc_bharat",   label: "Forge Shop B",    address: "MIDC Mundhwa, Pune" },
  { id: "site_hpsteel_1",  account_id: "acc_hpsteel",  label: "Rolling Mill",    address: "Toranagallu Rd, Hosapete" },
];

export const assets: Asset[] = [
  { id: "ast_krishna_m1",  account_id: "acc_krishna",  kind: "motor",       name: "Ring-frame drive motor", rating: "75 kW · 415V · 1480 rpm", serial: "CG-75-2291" },
  { id: "ast_sahyadri_t1", account_id: "acc_sahyadri", kind: "transformer", name: "Distribution transformer", rating: "500 kVA · 11kV/433V",    serial: "TX-500-0148" },
  { id: "ast_bharat_m1",   account_id: "acc_bharat",   kind: "motor",       name: "Hammer drive motor",     rating: "160 kW · 415V · 990 rpm", serial: "MR-160-7741" },
  { id: "ast_hpsteel_m1",  account_id: "acc_hpsteel",  kind: "motor",       name: "Rolling mill motor",     rating: "250 kW · 690V · 740 rpm", serial: "HP-250-3320" },
  { id: "ast_tata_p1",     account_id: "acc_tata",     kind: "pump",        name: "Coolant pump",           rating: "37 kW · 415V · 2950 rpm", serial: "RM-37-5582" },
];

export const contracts: Contract[] = [
  { id: "ctr_crompton",  account_id: "acc_sahyadri", ref: "AMC-CG-2026-04",  holder_account_id: "acc_crompton",   status: "active", start_date: "2026-04-01", end_date: "2027-03-31", value: 480000 },
  { id: "ctr_marathon",  account_id: "acc_bharat",   ref: "AMC-MR-2026-02",  holder_account_id: "acc_marathon",   status: "active", start_date: "2026-04-01", end_date: "2027-03-31", value: 620000 },
  { id: "ctr_roto",      account_id: "acc_tata",     ref: "AMC-RM-2026-05",  holder_account_id: "acc_rotomotive", status: "active", start_date: "2026-05-01", end_date: "2027-04-30", value: 360000 },
];

export const leads: Lead[] = [
  { id: "lead_krishna", account_id: "acc_krishna",  title: "Ring-frame motor burnt — rewind enquiry", source: "direct",       status: "quoted",     created_at: "2026-06-10" },
  { id: "lead_hpsteel", account_id: "acc_hpsteel",  title: "Rolling mill motor noisy — inspection",   source: "direct",       status: "inspecting", created_at: "2026-06-14" },
  { id: "lead_sahyadri",account_id: "acc_sahyadri", title: "Transformer oil test (AMC due)",          source: "amc",          status: "won",        created_at: "2026-06-02" },
  { id: "lead_bharat",  account_id: "acc_bharat",   title: "Hammer motor bearing replacement",        source: "oem_referral", status: "new",        created_at: "2026-06-16" },
];

export const quotes: Quote[] = [
  { id: "qt_krishna", account_id: "acc_krishna", ref: "QT-2026-0148", status: "approved", total: 86500,  created_at: "2026-06-11", valid_until: "2026-07-11", notes: "Price includes pickup and delivery within Hosapete. Additional copper surcharge may apply if current copper rate exceeds ₹750/kg." },
  { id: "qt_hpsteel", account_id: "acc_hpsteel", ref: "QT-2026-0152", status: "sent",     total: 142000, created_at: "2026-06-15", valid_until: "2026-07-15", notes: "Rotor balancing to IS 11723 standard. HV testing certificate provided on completion." },
  { id: "qt_bharat",  account_id: "acc_bharat",  ref: "QT-2026-0155", status: "draft",    total: 48500,  created_at: "2026-06-17", valid_until: "2026-07-17", notes: null },
];

export const quoteLines: QuoteLine[] = [
  // QT-2026-0148 — Krishna Textiles, 75 kW ring-frame motor rewind
  { id: "ql_k1", quote_id: "qt_krishna", description: "Stripping & cleaning of stator windings",        qty: 1,  rate: 8000,  amount: 8000  },
  { id: "ql_k2", quote_id: "qt_krishna", description: "HT insulation paper & slot liner material",       qty: 12, rate: 850,   amount: 10200 },
  { id: "ql_k3", quote_id: "qt_krishna", description: "Rewinding — 75 kW, 415 V, 1480 rpm, 3-phase",    qty: 1,  rate: 32000, amount: 32000 },
  { id: "ql_k4", quote_id: "qt_krishna", description: "Class F varnish treatment & oven baking",         qty: 1,  rate: 6500,  amount: 6500  },
  { id: "ql_k5", quote_id: "qt_krishna", description: "Bearing replacement — DE & NDE (SKF/FAG)",        qty: 2,  rate: 4800,  amount: 9600  },
  { id: "ql_k6", quote_id: "qt_krishna", description: "No-load & full-load testing, test certificate",   qty: 1,  rate: 5200,  amount: 5200  },
  { id: "ql_k7", quote_id: "qt_krishna", description: "Transportation — pickup & delivery, Hosapete",    qty: 1,  rate: 15000, amount: 15000 },

  // QT-2026-0152 — Hosapete Steel, 250 kW rolling mill motor
  { id: "ql_h1", quote_id: "qt_hpsteel", description: "Disassembly, cleaning & condition inspection",    qty: 1,  rate: 12000, amount: 12000 },
  { id: "ql_h2", quote_id: "qt_hpsteel", description: "Complete rewind — 250 kW, 690 V, 740 rpm",       qty: 1,  rate: 75000, amount: 75000 },
  { id: "ql_h3", quote_id: "qt_hpsteel", description: "Dynamic rotor balancing to IS 11723 G2.5",       qty: 1,  rate: 18000, amount: 18000 },
  { id: "ql_h4", quote_id: "qt_hpsteel", description: "Bearing replacement — 4 sets (Toller/SKF)",      qty: 4,  rate: 5500,  amount: 22000 },
  { id: "ql_h5", quote_id: "qt_hpsteel", description: "Enclosure repair, sealing & repainting",         qty: 1,  rate: 8000,  amount: 8000  },
  { id: "ql_h6", quote_id: "qt_hpsteel", description: "HV withstand test & insulation resistance cert", qty: 1,  rate: 7000,  amount: 7000  },

  // QT-2026-0155 — Bharat Forge, 160 kW hammer drive motor (draft)
  { id: "ql_b1", quote_id: "qt_bharat",  description: "Bearing replacement — DE & NDE, all 4 sets",     qty: 4,  rate: 5200,  amount: 20800 },
  { id: "ql_b2", quote_id: "qt_bharat",  description: "Shaft seal & end-shield gasket replacement",     qty: 1,  rate: 4200,  amount: 4200  },
  { id: "ql_b3", quote_id: "qt_bharat",  description: "Insulation resistance & vibration check",        qty: 1,  rate: 8500,  amount: 8500  },
  { id: "ql_b4", quote_id: "qt_bharat",  description: "Onsite labour — Bharat Forge, Pune (2 days)",    qty: 2,  rate: 7500,  amount: 15000 },
];

export const workOrders: WorkOrder[] = [
  { id: "wo_krishna",  account_id: "acc_krishna",  ref: "WO-2026-0301", asset_id: "ast_krishna_m1",  technician_id: "tech_ramesh", authorized_by: { kind: "quote", id: "qt_krishna" },    status: "in_progress", scheduled_for: "2026-06-18" },
  { id: "wo_sahyadri", account_id: "acc_sahyadri", ref: "WO-2026-0298", asset_id: "ast_sahyadri_t1", technician_id: "tech_suresh", authorized_by: { kind: "contract", id: "ctr_crompton" }, status: "completed",   scheduled_for: "2026-06-12" },
  { id: "wo_bharat",   account_id: "acc_bharat",   ref: "WO-2026-0305", asset_id: "ast_bharat_m1",   technician_id: "tech_anil",   authorized_by: { kind: "contract", id: "ctr_marathon" }, status: "scheduled",   scheduled_for: "2026-06-20" },
];

export const invoices: Invoice[] = [
  { id: "inv_sahyadri", account_id: "acc_sahyadri", ref: "INV-2026-0211", work_order_id: "wo_sahyadri", status: "sent", total: 0,     issued_at: "2026-06-13" },
  { id: "inv_krishna",  account_id: "acc_krishna",  ref: "INV-2026-0212", work_order_id: "wo_krishna",  status: "draft", total: 86500, issued_at: null },
];

export const activities: Activity[] = [
  { id: "act_1", account_id: "acc_krishna",  pillar: "marketing", text: "Enquiry received — ring-frame motor burnt",          at: "2026-06-10T09:20:00" },
  { id: "act_2", account_id: "acc_krishna",  pillar: "sales",     text: "Quote QT-2026-0148 sent (₹86,500) — approved",        at: "2026-06-11T16:05:00" },
  { id: "act_3", account_id: "acc_krishna",  pillar: "field",     text: "WO-2026-0301 assigned to Ramesh — rewind in progress", at: "2026-06-18T10:00:00" },
  { id: "act_4", account_id: "acc_sahyadri", pillar: "service",   text: "AMC oil-test job opened under Crompton contract",      at: "2026-06-02T11:30:00" },
  { id: "act_5", account_id: "acc_sahyadri", pillar: "field",     text: "WO-2026-0298 completed by Suresh — oil within limits", at: "2026-06-12T15:40:00" },
  { id: "act_6", account_id: "acc_sahyadri", pillar: "finance",   text: "Invoice INV-2026-0211 raised to Crompton (AMC)",       at: "2026-06-13T09:10:00" },
  { id: "act_7", account_id: "acc_bharat",   pillar: "marketing", text: "Referral from Marathon — hammer motor bearings",       at: "2026-06-16T13:00:00" },
];
