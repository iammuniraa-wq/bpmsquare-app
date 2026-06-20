// Seed fixtures — the first slice runs on these until a Supabase project is
// wired. Modelled on Vikas Pioneers (Hosapete) per PROJECT.md §6.
// Stable string ids keep cross-references readable.

import type {
  Account, Contact, Site, Asset, Contract, Lead, Quote, QuoteLine, QuoteRevision,
  WorkOrder, Invoice, Technician, TechnicianLeave, VisitLog, Activity, ServiceCase, CasePhoto, InspectionReport,
  PricingItem, TextFragment,
} from "@/lib/types";

export const technicians: Technician[] = [
  {
    id: "tech_ramesh", name: "Ramesh Kumar",
    phone: "+91 94482 11223", email: "ramesh.k@vikaspioneers.com",
    skills: "HT motor rewinding, stator repair, varnish treatment, test bed operation",
    certifications: ["HV License (IS 5571)", "Electrical Safety Supervisor (KSEB)"],
    cert_expiry: { "HV License (IS 5571)": "2027-03-31", "Electrical Safety Supervisor (KSEB)": "2026-12-31" },
    status: "active", base_location: "Hosapete", max_visits_per_day: 2,
  },
  {
    id: "tech_suresh", name: "Suresh Naik",
    phone: "+91 98802 44556", email: "suresh.n@vikaspioneers.com",
    skills: "Transformer oil testing, DGA, bushing inspection, AMC site visits",
    certifications: ["DGA Certified (IEC 60599)", "Thermography Level 1"],
    cert_expiry: { "DGA Certified (IEC 60599)": "2027-06-30", "Thermography Level 1": "2027-01-15" },
    status: "active", base_location: "Hubli", max_visits_per_day: 3,
  },
  {
    id: "tech_anil", name: "Anil Hegde",
    phone: "+91 97421 77889", email: "anil.h@vikaspioneers.com",
    skills: "Pump & generator overhaul, bearing replacement, alignment, vibration analysis",
    certifications: ["Vibration Analyst ISO Cat I", "Pump Hydraulics (KSB Certified)"],
    cert_expiry: { "Vibration Analyst ISO Cat I": "2026-09-30", "Pump Hydraulics (KSB Certified)": "2028-04-30" },
    status: "on_leave", base_location: "Hosapete", max_visits_per_day: 2,
  },
  {
    id: "tech_farhan", name: "Farhan Shaikh",
    phone: "+91 99001 33445", email: "farhan.s@vikaspioneers.com",
    skills: "LT/HT panel wiring, PLC commissioning, onsite field service, emergency callouts",
    certifications: ["Electrician License (ITI)", "PLC Fundamentals (Siemens)"],
    cert_expiry: { "Electrician License (ITI)": "2029-06-30", "PLC Fundamentals (Siemens)": "2027-09-30" },
    status: "active", base_location: "Hosapete", max_visits_per_day: 4,
  },
];

export const technicianLeaves: TechnicianLeave[] = [
  {
    id: "lv_anil_vacation", technician_id: "tech_anil",
    from_date: "2026-06-16", to_date: "2026-06-23",
    reason: "vacation", notes: "Annual family vacation — pre-approved.",
  },
  {
    id: "lv_ramesh_training", technician_id: "tech_ramesh",
    from_date: "2026-06-26", to_date: "2026-06-27",
    reason: "training", notes: "Refresher course — HV safety (KSEB, Hubli).",
  },
];

export const visitLogs: VisitLog[] = [
  {
    id: "vl_sahyadri_jun12", work_order_id: "wo_sahyadri", technician_id: "tech_suresh",
    account_id: "acc_sahyadri", visit_date: "2026-06-12",
    travel_start_time: "07:45", travel_distance_km: 62,
    arrived_time: "09:10",
    work_start_time: "09:20", break_start_time: "13:00", break_end_time: "13:45",
    work_end_time: "16:30",
    return_start_time: "16:45", return_end_time: "18:15",
    work_done: "Transformer oil dielectric strength test completed — 58 kV (limit 40 kV, pass). DGA sample collected and analysed on-site: H2 < 50 ppm, C2H2 = 0 (no arcing, pass). Visual inspection of all 6 bushings — surface contamination cleaned with dry cloth. Radiator fins checked — no leaks, top-up not required. Protection relay trip test performed — responded at 105% rated current.",
    parts_used: null,
    customer_feedback: "Very professional — Suresh explained all readings clearly. Happy with the certificate provided.",
    next_action: "Next AMC visit due Dec 2026. Recommend thermography scan of HT cable terminations before monsoon.",
    needs_escalation: false, customer_acknowledged: true, status: "completed",
  },
  {
    id: "vl_krishna_jun18", work_order_id: "wo_krishna", technician_id: "tech_ramesh",
    account_id: "acc_krishna", visit_date: "2026-06-18",
    travel_start_time: "08:30", travel_distance_km: 8,
    arrived_time: "08:45",
    work_start_time: "09:00", break_start_time: "13:00", break_end_time: "13:30",
    work_end_time: null,
    return_start_time: null, return_end_time: null,
    work_done: "Stator stripping and cleaning completed. Old windings removed and slot insulation replaced. New Class F winding in progress — 40% complete as of EOD.",
    parts_used: "HT insulation paper (12 sheets), slot liner material, Class F varnish (1L)",
    customer_feedback: null,
    next_action: "Continue winding tomorrow. Varnish and oven bake scheduled Jun 22. Test bed booking confirmed for Jun 24.",
    needs_escalation: false, customer_acknowledged: false, status: "in_progress",
  },
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

  // Prospects — being pursued, no active work yet.
  { id: "acc_rail",  name: "South Western Railway Stores", type: "prospect", city: "Hubballi", phone: "+91 836 555 4455", email: "stores@swr.in",      referred_by_account_id: null, created_at: "2026-06-01" },
  { id: "acc_sugar", name: "Renuka Sugar Works",           type: "prospect", city: "Belgaum",  phone: "+91 831 555 7788", email: "maint@renuka.co.in", referred_by_account_id: null, created_at: "2026-06-10" },
];

export const contacts: Contact[] = [
  { id: "con_krishna_1",  account_id: "acc_krishna",  name: "Mahesh Rao",     role: "Maintenance Head", phone: "+91 98860 11223", email: "mahesh@krishnatextiles.in" },
  { id: "con_sahyadri_1", account_id: "acc_sahyadri", name: "Dr. Nalini",     role: "Facilities Lead",  phone: "+91 99000 44556", email: "nalini@sahyadri.org" },
  { id: "con_bharat_1",   account_id: "acc_bharat",   name: "Sunil Kulkarni", role: "Plant Engineer",   phone: "+91 90110 77889", email: "sunil@bharatforge.com" },
  { id: "con_crompton_1", account_id: "acc_crompton", name: "Anita Desai",    role: "Service Manager",  phone: "+91 98200 33445", email: "anita@cromptongreaves.com" },
  { id: "con_rail_1",     account_id: "acc_rail",     name: "K. Venkatesh",   role: "Chief Engineer",   phone: "+91 98441 22334", email: "venkatesh@swr.in" },
  { id: "con_sugar_1",    account_id: "acc_sugar",    name: "Priya Nair",     role: "Maintenance Manager", phone: "+91 94491 55667", email: "priya@renuka.co.in" },
];

export const sites: Site[] = [
  { id: "site_krishna_1",  account_id: "acc_krishna",  label: "Spinning Unit",   address: "Plot 14, Industrial Area, Hosapete" },
  { id: "site_sahyadri_1", account_id: "acc_sahyadri", label: "Main Block",      address: "Vidyanagar, Hubli" },
  { id: "site_bharat_1",   account_id: "acc_bharat",   label: "Forge Shop B",    address: "MIDC Mundhwa, Pune" },
  { id: "site_hpsteel_1",  account_id: "acc_hpsteel",  label: "Rolling Mill",    address: "Toranagallu Rd, Hosapete" },
];

export const assets: Asset[] = [
  // ── Customer-owned assets ──────────────────────────────────────────────────
  {
    id: "ast_krishna_m1",  account_id: "acc_krishna",  kind: "motor",
    name: "Ring-frame drive motor",
    make: "Crompton Greaves",  model: "ND315S-2",
    rating: "75 kW · 415V · 1480 rpm",  serial: "CG-75-2291",
    notes: "Rewound once — June 2024. Bearings last replaced Jan 2025.",
    is_loaner: false, loaner_status: null,
  },
  {
    id: "ast_sahyadri_t1", account_id: "acc_sahyadri", kind: "transformer",
    name: "Distribution transformer",
    make: "Voltamp",           model: "ONAN-500-11/0.433",
    rating: "500 kVA · 11kV/433V",       serial: "TX-500-0148",
    notes: "Oil tested under AMC — last test May 2026. BDV: 58 kV.",
    is_loaner: false, loaner_status: null,
  },
  {
    id: "ast_bharat_m1",   account_id: "acc_bharat",   kind: "motor",
    name: "Hammer drive motor",
    make: "Marathon Electric", model: "MG280MC-6",
    rating: "160 kW · 415V · 990 rpm",   serial: "MR-160-7741",
    notes: "Bearings replaced March 2025. Vibration within spec as of last inspection.",
    is_loaner: false, loaner_status: null,
  },
  {
    id: "ast_hpsteel_m1",  account_id: "acc_hpsteel",  kind: "motor",
    name: "Rolling mill motor",
    make: "Rotomotive",        model: "GG355M-8",
    rating: "250 kW · 690V · 740 rpm",   serial: "HP-250-3320",
    notes: "Covered under AMC (ctr_marathon). Noisy bearing reported June 2026.",
    is_loaner: false, loaner_status: null,
  },
  {
    id: "ast_tata_p1",     account_id: "acc_tata",     kind: "pump",
    name: "Coolant pump",
    make: "Kirloskar",         model: "KDS-316",
    rating: "37 kW · 415V · 2950 rpm",   serial: "RM-37-5582",
    notes: null,
    is_loaner: false, loaner_status: null,
  },

  // ── Company loaner stock (Vikas Pioneers — account_id null) ───────────────
  {
    id: "lnr_motor_45k",   account_id: null, kind: "motor",
    name: "Loaner — 45 kW standard motor",
    make: "Crompton Greaves",  model: "ND250M-2",
    rating: "45 kW · 415V · 1480 rpm",  serial: "VP-LNR-001",
    notes: null,
    is_loaner: true, loaner_status: "on_loan",
  },
  {
    id: "lnr_motor_22k",   account_id: null, kind: "motor",
    name: "Loaner — 22 kW general purpose",
    make: "Marathon Electric", model: "MG200LA-2",
    rating: "22 kW · 415V · 1480 rpm",  serial: "VP-LNR-002",
    notes: null,
    is_loaner: true, loaner_status: "available",
  },
  {
    id: "lnr_pump_37k",    account_id: null, kind: "pump",
    name: "Loaner — 37 kW centrifugal pump",
    make: "Kirloskar",         model: "KDS-280",
    rating: "37 kW · 415V · 2950 rpm",  serial: "VP-LNR-003",
    notes: null,
    is_loaner: true, loaner_status: "available",
  },
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
  { id: "qt_krishna", account_id: "acc_krishna", ref: "QT-2026-0148", status: "approved", total: 86500,  created_at: "2026-06-11", valid_until: "2026-07-11", revision: 2, notes: "Price includes pickup and delivery within Hosapete. Additional copper surcharge may apply if current copper rate exceeds ₹750/kg. Payment: 50% advance, balance on delivery." },
  { id: "qt_hpsteel", account_id: "acc_hpsteel", ref: "QT-2026-0152", status: "sent",     total: 142000, created_at: "2026-06-15", valid_until: "2026-07-15", revision: 1, notes: "Rotor balancing to IS 11723 G2.5 standard. HV withstand test certificate provided on completion. Payment: 40% advance, 60% against delivery." },
  { id: "qt_bharat",  account_id: "acc_bharat",  ref: "QT-2026-0155", status: "draft",    total: 48500,  created_at: "2026-06-17", valid_until: "2026-07-17", revision: 1, notes: null },
];

export const quoteRevisions: QuoteRevision[] = [
  // QT-2026-0148 — Krishna Textiles — 2 revisions
  { id: "qr_k1", quote_id: "qt_krishna", rev: 1, date: "2026-06-11", description: "Initial quotation issued. Transport cost estimated at ₹12,000." },
  { id: "qr_k2", quote_id: "qt_krishna", rev: 2, date: "2026-06-13", description: "Bearing upgraded from generic to SKF/FAG premium grade. Transport revised to ₹15,000 on account of fuel surcharge. Copper rate note added to terms." },
  // QT-2026-0152 — Hosapete Steel — 1 revision
  { id: "qr_h1", quote_id: "qt_hpsteel", rev: 1, date: "2026-06-15", description: "Initial quotation issued." },
  // QT-2026-0155 — Bharat Forge — 1 revision
  { id: "qr_b1", quote_id: "qt_bharat",  rev: 1, date: "2026-06-17", description: "Initial draft prepared after site inspection." },
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
  {
    id: "wo_krishna", account_id: "acc_krishna", ref: "WO-2026-0301",
    case_id: "case_krishna",
    asset_id: "ast_krishna_m1", technician_id: "tech_ramesh",
    authorized_by: { kind: "quote", id: "qt_krishna" },
    status: "in_progress", scheduled_for: "2026-06-18",
    description: "Full stator rewind — 75 kW, 415V, 1480 rpm, Class F insulation. Replace DE & NDE bearings (SKF/FAG). Varnish treatment and oven bake. No-load and full-load testing.",
    notes: "Customer's spinning line B is down. Priority completion by 25 Jun. Ensure phase-failure relay recommendation is in handover note.",
  },
  {
    id: "wo_sahyadri", account_id: "acc_sahyadri", ref: "WO-2026-0298",
    case_id: null,
    asset_id: "ast_sahyadri_t1", technician_id: "tech_suresh",
    authorized_by: { kind: "contract", id: "ctr_crompton" },
    status: "completed", scheduled_for: "2026-06-12",
    description: "AMC routine — transformer oil dielectric strength test, dissolved gas analysis (DGA), and visual inspection of bushings and radiators.",
    notes: "Oil test results within limits — dielectric strength 58 kV (limit 40 kV). DGA normal. Bushing surfaces cleaned. Certificate issued.",
  },
  {
    id: "wo_bharat", account_id: "acc_bharat", ref: "WO-2026-0305",
    case_id: "case_bharat",
    asset_id: "ast_bharat_m1", technician_id: "tech_anil",
    authorized_by: { kind: "contract", id: "ctr_marathon" },
    status: "scheduled", scheduled_for: "2026-06-20",
    description: "Bearing replacement — DE & NDE sets (160 kW, 415V). Replace labyrinth seal and end-shield gaskets. Insulation resistance and vibration check on reassembly.",
    notes: "Loaner VP-LNR-001 dispatched to Pune site. Coordinate with Sunil Kulkarni for unit collection once ready.",
  },
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

// ── Cases ────────────────────────────────────────────────────────────────────

export const serviceCases: ServiceCase[] = [
  {
    id: "case_krishna",
    account_id: "acc_krishna",
    ref: "CS-2026-0089",
    type: "direct",
    status: "in_repair",
    asset_id: "ast_krishna_m1",
    equipment_label: "Crompton 75 kW 3-Ph IM · CG-75-2291",
    complaint: "Stator winding burnt — complete failure. Motor tripped on OLR and refuses to restart. Heavy burning smell from enclosure.",
    assigned_to: "tech_ramesh",
    intake_at: "2026-06-10T08:30:00",
    closed_at: null,
    quote_id: "qt_krishna",
    contract_id: null,
    has_loaner: false,
    loaner_asset_id: null,
    parent_case_id: null,
    disposition: "repair",
    notes: "Customer needs motor back by 25 Jun — spinning line B is down. Priority job.",
  },
  {
    id: "case_hpsteel",
    account_id: "acc_hpsteel",
    ref: "CS-2026-0092",
    type: "direct",
    status: "report_sent",
    asset_id: "ast_hpsteel_m1",
    equipment_label: "Marathon 250 kW 3-Ph IM · HP-250-3320",
    complaint: "Excessive vibration and noise at full load. Bearing temperature alarm on DE side. Rolling mill running at reduced speed.",
    assigned_to: "tech_suresh",
    intake_at: "2026-06-14T10:15:00",
    closed_at: null,
    quote_id: "qt_hpsteel",
    contract_id: null,
    has_loaner: false,
    loaner_asset_id: null,
    parent_case_id: null,
    disposition: null,
    notes: "HV motor — handle with care. 690V class. Ensure HV test cert on completion.",
  },
  {
    id: "case_bharat",
    account_id: "acc_bharat",
    ref: "CS-2026-0095",
    type: "amc",
    status: "inspection",
    asset_id: "ast_bharat_m1",
    equipment_label: "Marathon 160 kW 3-Ph IM · MR-160-7741",
    complaint: "Bearing noise — DE side. Grease leaking from end-shield. Intermittent vibration trip.",
    assigned_to: "tech_anil",
    intake_at: "2026-06-17T14:00:00",
    closed_at: null,
    quote_id: null,
    contract_id: "ctr_marathon",
    has_loaner: true,
    loaner_asset_id: "lnr_motor_45k",
    parent_case_id: null,
    disposition: null,
    notes: "AMC case under Marathon contract AMC-MR-2026-02. Loaner VP-LNR-001 dispatched to Bharat Forge Pune — coordinate return on delivery.",
  },
  {
    // Sub-case discovered during inspection of case_bharat
    id: "case_bharat_winding",
    account_id: "acc_bharat",
    ref: "CS-2026-0095-A",
    type: "amc",
    status: "inspection",
    asset_id: "ast_bharat_m1",
    equipment_label: "Marathon 160 kW 3-Ph IM · MR-160-7741",
    complaint: "Insulation resistance on Phase B found below threshold (8 MΩ, limit 10 MΩ) during bearing inspection. Possible early winding degradation.",
    assigned_to: "tech_ramesh",
    intake_at: "2026-06-18T09:00:00",
    closed_at: null,
    quote_id: null,
    contract_id: "ctr_marathon",
    has_loaner: false,
    loaner_asset_id: null,
    parent_case_id: "case_bharat",
    disposition: null,
    notes: "Discovered during Phase B IR check. May need partial rewind if further tests confirm degradation. Raise separate quote if not AMC-covered.",
  },
];

export const casePhotos: CasePhoto[] = [
  // CS-2026-0089 — Krishna Textiles — intake
  { id: "ph_k_i1", case_id: "case_krishna", stage: "intake", caption: "Gate receipt — motor on trolley, nameplate visible", taken_at: "2026-06-10T08:35:00" },
  { id: "ph_k_i2", case_id: "case_krishna", stage: "intake", caption: "Burnt terminal box — visible carbon deposits on leads", taken_at: "2026-06-10T08:37:00" },
  { id: "ph_k_i3", case_id: "case_krishna", stage: "intake", caption: "DE bearing end — grease discolouration noted", taken_at: "2026-06-10T08:39:00" },
  // CS-2026-0089 — inspection
  { id: "ph_k_s1", case_id: "case_krishna", stage: "inspection", caption: "Stator after stripping — Phase U winding completely burnt, carbon on slots", taken_at: "2026-06-11T10:20:00" },
  { id: "ph_k_s2", case_id: "case_krishna", stage: "inspection", caption: "Rotor surface — no mechanical damage, shaft runout within tolerance", taken_at: "2026-06-11T10:28:00" },
  { id: "ph_k_s3", case_id: "case_krishna", stage: "inspection", caption: "DE bearing removed — inner race pitting confirmed", taken_at: "2026-06-11T10:35:00" },

  // CS-2026-0092 — Hosapete Steel — intake
  { id: "ph_h_i1", case_id: "case_hpsteel", stage: "intake", caption: "Motor at gate — transport cradle intact, nameplate photographed", taken_at: "2026-06-14T10:20:00" },
  { id: "ph_h_i2", case_id: "case_hpsteel", stage: "intake", caption: "DE bearing housing — visible oil leak at labyrinth seal", taken_at: "2026-06-14T10:24:00" },
  // CS-2026-0092 — inspection
  { id: "ph_h_s1", case_id: "case_hpsteel", stage: "inspection", caption: "DE bearing removed — heavy pitting on outer race, cage deformed", taken_at: "2026-06-15T09:10:00" },
  { id: "ph_h_s2", case_id: "case_hpsteel", stage: "inspection", caption: "Rotor — dynamic balance check setup, unbalance reading 12 g·mm (limit: 4 g·mm)", taken_at: "2026-06-15T11:00:00" },
  { id: "ph_h_s3", case_id: "case_hpsteel", stage: "inspection", caption: "Winding insulation resistance — Phase R: 42 MΩ, Phase Y: 38 MΩ, Phase B: 41 MΩ (acceptable)", taken_at: "2026-06-15T14:15:00" },

  // CS-2026-0095 — Bharat Forge — intake only
  { id: "ph_b_i1", case_id: "case_bharat", stage: "intake", caption: "Motor received from Bharat Forge Pune — logistics partner delivery", taken_at: "2026-06-17T14:05:00" },
  { id: "ph_b_i2", case_id: "case_bharat", stage: "intake", caption: "DE end-shield — grease leakage and discolouration around labyrinth seal", taken_at: "2026-06-17T14:10:00" },
];

export const inspectionReports: InspectionReport[] = [
  {
    id: "ir_krishna",
    case_id: "case_krishna",
    findings: "Phase U stator winding is completely burnt due to sustained single-phasing — all three phases affected on stator slots 1–18. Insulation degraded to Class E (original Class F). DE bearing (6315) shows inner-race pitting; NDE bearing serviceable. Rotor in good condition — no mechanical damage, shaft runout 0.02 mm (within tolerance). Terminal box leads require replacement.",
    recommendations: "Full stator rewind in Class F / Class H insulation. Replace both DE and NDE bearings as a set (SKF or FAG). Re-varnish and oven-bake post-rewind. Full no-load and load test before dispatch. Recommend customer install phase-failure relay to prevent recurrence.",
    estimated_cost: 86500,
    status: "approved",
    sent_at: "2026-06-11T17:00:00",
    approved_at: "2026-06-13T09:30:00",
  },
  {
    id: "ir_hpsteel",
    case_id: "case_hpsteel",
    findings: "DE bearing (NU 2320) heavily pitted with cage deformation — primary cause of vibration and noise. NDE bearing (6320) shows early-stage wear, replacement recommended. Dynamic balance check shows residual unbalance of 12 g·mm on rotor (IS 11723 G2.5 limit: 4 g·mm) — balancing required. Winding insulation resistance satisfactory (38–42 MΩ, limit: 10 MΩ). Labyrinth seal worn — oil leakage evident.",
    recommendations: "Replace DE and NDE bearings (Toller or SKF). Perform dynamic rotor balancing to IS 11723 G2.5. Replace labyrinth seals and refit end-shields. HV withstand test (1500V / 1 min) on winding before reassembly. Issue HV test certificate on completion.",
    estimated_cost: 142000,
    status: "sent",
    sent_at: "2026-06-15T16:30:00",
    approved_at: null,
  },
];

// ── Pricing catalog ────────────────────────────────────────────────────────────

export const pricingItems: PricingItem[] = [
  // Labour
  { id: "pr_l1",  category: "labour",    description: "Motor rewinding — up to 30 kW (415V, 3-phase)",               unit: "per job",     rate: 18000, notes: "Includes stator strip, rewind, varnish, oven bake, no-load test" },
  { id: "pr_l2",  category: "labour",    description: "Motor rewinding — 31–75 kW (415V, 3-phase)",                  unit: "per job",     rate: 32000, notes: "Includes Class F insulation, SKF/FAG bearings optional" },
  { id: "pr_l3",  category: "labour",    description: "Motor rewinding — 76–150 kW (415V, 3-phase)",                 unit: "per job",     rate: 52000, notes: null },
  { id: "pr_l4",  category: "labour",    description: "Motor rewinding — above 150 kW (HT/LT)",                      unit: "per job",     rate: 85000, notes: "Rate subject to coil design complexity" },
  { id: "pr_l5",  category: "labour",    description: "Bearing replacement — DE & NDE set",                           unit: "per set",     rate: 4500,  notes: "Labour only; bearing cost extra" },
  { id: "pr_l6",  category: "labour",    description: "Pump overhaul — mechanical seal, impeller, casing inspection", unit: "per job",     rate: 14000, notes: null },
  { id: "pr_l7",  category: "labour",    description: "Panel wiring & commissioning",                                  unit: "per job",     rate: 8000,  notes: null },
  { id: "pr_l8",  category: "labour",    description: "Transformer oil replacement & servicing",                       unit: "per job",     rate: 6500,  notes: "Oil cost billed separately" },
  { id: "pr_l9",  category: "labour",    description: "Onsite service visit — half day (up to 4 hours)",               unit: "per visit",   rate: 4500,  notes: "Within 50 km of Hosapete" },
  { id: "pr_l10", category: "labour",    description: "Onsite service visit — full day (up to 8 hours)",               unit: "per visit",   rate: 7500,  notes: "Within 50 km of Hosapete" },
  { id: "pr_l11", category: "labour",    description: "Emergency callout — after hours / weekend",                     unit: "per callout", rate: 12000, notes: "Applies outside 9 AM–6 PM Mon–Sat" },
  { id: "pr_l12", category: "labour",    description: "Dynamic rotor balancing — IS 11723 G2.5",                       unit: "per job",     rate: 18000, notes: null },

  // Materials
  { id: "pr_m1",  category: "material",  description: "Copper wire — Class F (IS 13730)",                             unit: "per kg",      rate: 850,   notes: "Rate subject to copper market price" },
  { id: "pr_m2",  category: "material",  description: "HT insulation paper (IS 1576)",                                unit: "per sheet",   rate: 420,   notes: null },
  { id: "pr_m3",  category: "material",  description: "SKF/FAG bearing — 6315 (DE, standard)",                        unit: "per piece",   rate: 4200,  notes: null },
  { id: "pr_m4",  category: "material",  description: "Toller/SKF bearing — NU 2320 (heavy duty)",                    unit: "per piece",   rate: 5800,  notes: null },
  { id: "pr_m5",  category: "material",  description: "Class F varnish — alkyd resin (IS 1866)",                      unit: "per litre",   rate: 680,   notes: null },
  { id: "pr_m6",  category: "material",  description: "Transformer oil — IS 335 grade",                               unit: "per litre",   rate: 280,   notes: null },
  { id: "pr_m7",  category: "material",  description: "Labyrinth seal kit (complete)",                                 unit: "per set",     rate: 1200,  notes: null },
  { id: "pr_m8",  category: "material",  description: "Slot liner & wedge material",                                   unit: "per set",     rate: 950,   notes: null },

  // Testing
  { id: "pr_t1",  category: "testing",   description: "No-load & full-load test with certificate (IS 325)",            unit: "per test",    rate: 5200,  notes: "Includes test report, signed certificate" },
  { id: "pr_t2",  category: "testing",   description: "HV withstand test — 1500V / 1 min (IS 2148)",                  unit: "per test",    rate: 3500,  notes: "HV certificate issued on pass" },
  { id: "pr_t3",  category: "testing",   description: "Dissolved Gas Analysis (DGA) — IEC 60599",                     unit: "per sample",  rate: 4800,  notes: "H2, CH4, C2H2, C2H4, C2H6 gases reported" },
  { id: "pr_t4",  category: "testing",   description: "Insulation resistance (Megger) — 500V / 1000V",                 unit: "per test",    rate: 800,   notes: null },
  { id: "pr_t5",  category: "testing",   description: "Vibration analysis & report — ISO 10816",                       unit: "per test",    rate: 3200,  notes: null },
  { id: "pr_t6",  category: "testing",   description: "Thermography scan — Level I report",                            unit: "per scan",    rate: 2800,  notes: null },
  { id: "pr_t7",  category: "testing",   description: "Dielectric strength test (oil) — IS 6792",                      unit: "per test",    rate: 1800,  notes: "Test at 50 kV, pass limit 40 kV" },

  // Transport
  { id: "pr_tr1", category: "transport", description: "Local pickup & delivery — within Hosapete",                     unit: "per trip",    rate: 8000,  notes: "Includes loading/unloading" },
  { id: "pr_tr2", category: "transport", description: "Long-distance transport — per km (one way)",                    unit: "per km",      rate: 45,    notes: "Minimum 100 km billing" },
  { id: "pr_tr3", category: "transport", description: "Crane hire — for heavy motors (>500 kg)",                       unit: "per day",     rate: 6500,  notes: "½-day minimum billing" },
];

// ── Text fragments ──────────────────────────────────────────────────────────────

export const textFragments: TextFragment[] = [
  // Line item descriptions
  { id: "fr_li1", category: "line_item", label: "Full motor rewind scope",
    text: "Full stator rewind in Class F / Class H insulation. Strip and clean stator slots. Replace DE & NDE bearings (SKF/FAG). Varnish treatment and oven bake. No-load and full-load test with certificate. Phase-failure relay recommendation in handover note." },
  { id: "fr_li2", category: "line_item", label: "Bearing replacement scope",
    text: "Replace drive-end (DE) and non-drive-end (NDE) bearings (SKF/FAG/Toller). Clean and degrease bearing housings. Apply fresh high-temperature grease. Reassemble, align, and test run. Vibration and temperature check post-assembly." },
  { id: "fr_li3", category: "line_item", label: "AMC site visit scope",
    text: "Scheduled AMC preventive maintenance visit. Visual inspection of equipment condition, cleaning of cooling fins and terminal box, lubrication of bearings, insulation resistance check, parameter recording (current, voltage, temperature). Service report submitted on completion." },
  { id: "fr_li4", category: "line_item", label: "Transformer oil service scope",
    text: "Drain and replace transformer oil (IS 335 grade). Clean conservator and buchholz relay. Perform dielectric strength test on new oil. Top up to rated level. Visual inspection of bushings, radiators, and gaskets. Issue oil test certificate." },
  { id: "fr_li5", category: "line_item", label: "Pump overhaul scope",
    text: "Disassemble pump. Replace mechanical seal, impeller wear rings, and shaft sleeve. Inspect casing for cavitation damage. Reassemble and align to motor. Run test and record flow / pressure / power consumption. Issue overhaul report." },

  // Notes
  { id: "fr_n1", category: "notes", label: "Copper rate clause",
    text: "Note: Quoted price is based on copper at ₹750/kg. If copper rate exceeds ₹750/kg at time of rewinding, a material surcharge of ₹1,500 per kW will apply and will be intimated before commencement of work." },
  { id: "fr_n2", category: "notes", label: "Standard warranty",
    text: "Warranty: 12 months on rewinding workmanship from date of dispatch. Warranty is void if the motor is operated with a defective overload relay, on unbalanced/fluctuating supply, or subjected to single-phasing without protection." },
  { id: "fr_n3", category: "notes", label: "Transport note",
    text: "Transport charges above are for local Hosapete pickup and delivery only. For outstation sites, freight charges will be at actuals by road transport and will be added to the final invoice." },
  { id: "fr_n4", category: "notes", label: "Loaner motor note",
    text: "A loaner motor will be provided during the repair period subject to availability. Loaner unit remains the property of Vikas Pioneers India Pvt Ltd and must be returned in good condition on delivery of the repaired unit." },
  { id: "fr_n5", category: "notes", label: "Priority job note",
    text: "This job has been flagged as PRIORITY by the customer. We will endeavour to complete and dispatch within the agreed timeline. Any delays due to non-availability of materials will be communicated immediately." },

  // Terms
  { id: "fr_t1", category: "terms", label: "Standard payment terms",
    text: "Payment Terms: 50% advance on order confirmation; balance before dispatch. Cheque / NEFT in favour of Vikas Pioneers India Pvt Ltd. GST @ 18% applicable on all services and materials. No dispatch without clearance of balance." },
  { id: "fr_t2", category: "terms", label: "AMC payment terms",
    text: "AMC charges are payable quarterly in advance. Failure to pay within 30 days of due date will render the AMC contract void for that quarter. Parts and materials not covered under AMC scope will be charged separately at actuals." },
  { id: "fr_t3", category: "terms", label: "Standard T&C",
    text: "1. Prices are ex-works Hosapete unless stated otherwise.\n2. Quotation valid for 30 days from date of issue.\n3. All electrical testing carried out per relevant IS/IEC standards.\n4. Vikas Pioneers is not liable for delays due to non-availability of OEM spares.\n5. Customer must provide safe access for onsite visits; site safety compliance is the customer's responsibility.\n6. Disputes subject to Hosapete jurisdiction only." },
  { id: "fr_t4", category: "terms", label: "Emergency / callout T&C",
    text: "Emergency callout charges apply for calls received outside business hours (9 AM–6 PM, Mon–Sat) and on public holidays. Callout fee covers mobilisation only; actual repair/service is billed separately. Minimum billing: 4 hours at applicable labour rate." },
];
