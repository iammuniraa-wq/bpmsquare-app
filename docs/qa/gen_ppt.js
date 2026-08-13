const path = "/tmp/claude-0/-home-user-bpmsquare-app/68c273eb-b9be-55f5-addc-498ca7ca7cfd/scratchpad/node_modules/pptxgenjs";
const PptxGenJS = require(path);

// Palette taken from the product's own WFM identity: the dark sidebar
// gradient (#152233 → #0e1a28) and the amber pillar WFM is assigned.
const NAVY = "0E1A28";
const NAVY2 = "1B2C3F";
const SLATE = "33475B";
const AMBER = "E08A2E";
const AMBER_L = "F6C177";
const PAPER = "FFFFFF";
const WASH = "F3F5F7";
const INK = "16202B";
const MUTED = "5C6B7A";
const LINE = "D9DEE4";

const W = 13.3, H = 7.5, M = 0.6;

const pres = new PptxGenJS();
pres.layout = "LAYOUT_WIDE";
pres.author = "BPMSquare";
pres.title = "BPMSquare — Workforce Management";

/* ── content ─────────────────────────────────────────────────────────── */
const FEATURES = [
  {
    name: "Punch in, break, punch out",
    sum: "Attendance is captured as individual punch events. Nothing is ever edited in place.",
    pts: [
      "One button that always shows your only legal next action",
      "Optional selfie and GPS position attached to each punch",
      "Works offline — queued punches sync when signal returns",
    ],
    who: ["Employee"],
    role: "EMPLOYEE",
    paths: ["Workforce", "My Workforce", "Home"],
    steps: [
      "Open My Workforce from the sidebar.",
      "Accept the one-time consent prompt — punching is blocked until you do.",
      "Tap Check in. Allow location if your workspace uses geofencing.",
      "Tap Break and End break during the day, then Check out when you leave.",
    ],
    note: "If Check in isn't offered, you are already checked in — the button never shows an illegal action.",
  },
  {
    name: "Punching with no signal",
    sum: "A dead spot doesn't cost anyone their attendance. The punch is captured on the device and sent when the network returns.",
    pts: [
      "Timestamped at CAPTURE, not at sync — 09:02 stays 09:02",
      "Selfie and GPS are held with it and uploaded on reconnect",
      "Each punch carries its own id, so a retry can never double-count",
    ],
    who: ["Employee", "Nothing to configure"],
    role: "EMPLOYEE",
    paths: ["Workforce", "My Workforce", "Home"],
    steps: [
      "Punch exactly as normal — there is no offline button and no mode to switch.",
      "With no signal the screen confirms the punch was saved on the device.",
      "It sends itself when the network returns, or next time the screen is opened.",
      "Queued punches go oldest first, so the sequence is preserved.",
    ],
    note: "Always on: losing a punch to a dead workshop corner is never the better outcome. The app does need to have been opened once on that device.",
  },
  {
    name: "Punch types: OT, mobile work, trips",
    sum: "Extra punch types sit in a dropdown next to the main button — only the ones your workspace switches on.",
    pts: [
      "OT in / OT out — overtime as its own paid session",
      "Mobile work and Business trip — ordinary hours, labelled",
      "A disabled type is refused by the server, not merely hidden",
    ],
    who: ["Admin enables", "Employee uses"],
    role: "ADMIN",
    paths: ["Settings", "Workforce", "General", "Punch types"],
    steps: [
      "Open Settings → Workforce and stay on the General tab.",
      "Scroll to Punch types and switch on the ones this client uses.",
      "Set OT rate per hour in the same tab. Zero means hours are tracked but no cost is computed.",
      "Save. The dropdown appears for every employee immediately.",
    ],
    note: "Enable Overtime before asking anyone to punch it — the API rejects a disabled punch type.",
  },
  {
    name: "Overtime — record and approve",
    sum: "Overtime is a separate session, punched after checking out, and paid only once a supervisor approves it.",
    pts: [
      "OT cannot start while checked in — structurally prevented",
      "Exact minutes, no rounding, at a flat rate per hour",
      "An all-night block stays on the day it started",
    ],
    who: ["Employee punches", "Supervisor approves"],
    role: "EMPLOYEE + SUPERVISOR",
    paths: ["Workforce", "Corrections", "Overtime"],
    steps: [
      "Employee checks OUT of the regular shift first — this is required.",
      "Employee picks OT in from the punch dropdown, then OT out when finished.",
      "Supervisor opens Workforce → Corrections → Overtime tab.",
      "Review the date, duration and +1d marker, then Approve or Reject.",
    ],
    note: "A remark is mandatory to reject. Pending and rejected overtime is visible everywhere but counted nowhere.",
  },
  {
    name: "Monthly timeline",
    sum: "One calendar month per page, each day drawn as a horizontal bar against a time axis.",
    pts: [
      "Work, break and overtime shown as separate bands",
      "Pending overtime is faded and dashed until approved",
      "Click any day to open its detail and file a correction",
    ],
    who: ["Employee"],
    role: "EMPLOYEE",
    paths: ["Workforce", "My Workforce", "Timeline"],
    steps: [
      "Open My Workforce and choose the Timeline tab.",
      "Use the month arrows to move between months.",
      "Click a day's bar to open the detail popup.",
      "Choose “Request a correction for this day” if something is wrong.",
    ],
    note: "Faded, dashed bands mean overtime that is still waiting for supervisor approval.",
  },
  {
    name: "Apply for leave",
    sum: "Pick dates by dragging across a calendar rather than typing two dates into boxes.",
    pts: [
      "Click a single day, or drag across a range",
      "Holidays, week-offs and existing leave are marked before you submit",
      "Half day appears only when the from and to dates match",
    ],
    who: ["Employee"],
    role: "EMPLOYEE",
    paths: ["Workforce", "My Workforce", "Leave"],
    steps: [
      "Open My Workforce → Leave. Your requests are the first thing you see.",
      "Press + Request leave, then drag across the days you want.",
      "Pick the leave type and write a reason.",
      "Submit — it reaches your supervisor as Pending.",
    ],
    note: "Balances sit behind the Leave balance toggle — open it for the chart, or read the totals on the row itself.",
  },
  {
    name: "Leave approval and records",
    sum: "Approving a request writes a real leave record. That record, not the request, moves the balance.",
    pts: [
      "Pending queue with one-click approve or reject",
      "Supervisors can also enter leave directly, with no request",
      "Rejection always requires a written remark",
    ],
    who: ["Supervisor"],
    role: "SUPERVISOR",
    paths: ["Workforce", "Leave & Holidays"],
    steps: [
      "Open Workforce → Leave & Holidays.",
      "Filter the list to Pending.",
      "Approve or Reject each request — a remark is required to reject.",
      "Use Leave records below to add or remove leave directly.",
    ],
    note: "Approved leave suppresses late and absent marks for every day it covers.",
  },
  {
    name: "Attendance corrections",
    sum: "Employees ask for a fix. Only a supervisor's approval actually changes attendance.",
    pts: [
      "Missing check-in, missing check-out, wrong time, or other",
      "Approval adds a new event and supersedes the old one",
      "The proposed time must fall on the day being corrected",
    ],
    who: ["Employee files", "Supervisor approves"],
    role: "EMPLOYEE + SUPERVISOR",
    paths: ["Workforce", "Corrections"],
    steps: [
      "Employee opens My Workforce → Time, or a day in the Timeline.",
      "Files the correction with the proposed time and a reason.",
      "Supervisor opens Workforce → Corrections.",
      "Approve or Reject, with a remark.",
    ],
    note: "Filing changes nothing — attendance moves only on approval. A \u201Cwrong time\u201D correction now moves the punch it names; previously it was approved but changed nothing.",
  },
  {
    name: "Recheck requests",
    sum: "A supervisor queries a punch and asks the employee to explain it — the mirror of a correction.",
    pts: [
      "Flag a single punch or an entire day",
      "Ask about the time, the selfie, or both",
      "Attendance never changes from a recheck alone — a fix still needs a correction",
    ],
    who: ["Supervisor flags", "Employee responds"],
    role: "SUPERVISOR",
    paths: ["Workforce", "Corrections", "Recheck requests"],
    steps: [
      "Open Workforce → Corrections → Recheck requests.",
      "Choose the employee, the date, and what to recheck.",
      "Write the message and send — the employee is emailed.",
      "The employee replies from My Workforce; you then resolve or dismiss it.",
    ],
    note: "Why it exists: punches are append-only, so a supervisor cannot simply edit one they doubt. This is how they ask.",
  },
  {
    name: "Roster and shift planning",
    sum: "Bulk shift and site planning layered on top of everyone's standing shift.",
    pts: [
      "Assign many employees across many dates in one action",
      "Mark days off — no lateness or absence is marked on those",
      "The roster now decides who counts as late, not the standing shift",
    ],
    who: ["Supervisor"],
    role: "SUPERVISOR",
    paths: ["Workforce", "Roster"],
    steps: [
      "Open Workforce → Roster.",
      "Select the employees, then tick the dates.",
      "Choose the shift, or mark the days as Day off, and optionally a site.",
      "Apply — any existing entry for those dates is overwritten.",
    ],
    note: "Roster someone onto a different shift and lateness follows it the same day. Limits per action: 500 employees, 62 dates, 3000 combinations.",
  },
  {
    name: "Live board",
    sum: "Who is in, who is late and who has not arrived — for today, at a glance.",
    pts: [
      "State, first in and last out for every employee",
      "Late and absent computed against the shift and its grace",
      "Geofence flags surfaced on the row",
    ],
    who: ["Supervisor"],
    role: "SUPERVISOR",
    paths: ["Workforce", "Live board"],
    steps: [
      "Open Workforce → Live board.",
      "Leave it open — it refreshes roughly every 30 seconds on its own.",
      "Click a row to see that person's punches, selfies and map positions.",
    ],
    note: "The fastest way to catch a missing check-out before it turns into a correction request.",
  },
  {
    name: "Who sees and approves what",
    sum: "Each site has one supervisor, and they handle that site's people — nobody else's.",
    pts: [
      "Your approver is whoever runs the site you're assigned to",
      "Move site next month and approvals follow, with no re-mapping",
      "A manager sees every site beneath them, and their supervisors too",
    ],
    who: ["Admin sets it up", "Everyone is scoped by it"],
    role: "ADMIN",
    paths: ["Settings", "Workforce", "Sites"],
    steps: [
      "Settings → Workforce → Sites. Edit each site and name its supervisor.",
      "Workforce → Employees. Open each supervisor and set THEIR supervisor — the manager.",
      "That's the whole hierarchy. Queues, board, summary and analytics all follow it.",
      "Anyone you name as a site supervisor is given supervisor access automatically.",
    ],
    note: "Nobody can approve their own request — it always goes to the person above them, admins included.",
  },
  {
    name: "Employees and the Employee Hub",
    sum: "The people master, plus one page that gathers everything about a single employee.",
    pts: [
      "Codes are generated — leave the field blank for the next one",
      "Shift, site, reporting supervisor and employment type",
      "Hub shows month totals, leave balance and direct reports",
    ],
    who: ["Supervisor", "Admin"],
    role: "SUPERVISOR + ADMIN",
    paths: ["Workforce", "Employees"],
    steps: [
      "Open Workforce → Employees. + New employee opens its own page.",
      "Leave Code blank to get the next EMP-#### , or type your own scheme.",
      "Set the shift, site, supervisor and employment type.",
      "Use the login action to issue an email address and initial password.",
    ],
    note: "A typed code that already exists is refused rather than overwritten. The employee must change the initial password at first sign-in.",
  },
  {
    name: "Monthly summary and Excel export",
    sum: "The whole month, per employee, in the shape the accountant actually needs.",
    pts: [
      "Days present, working hours, late marks and leave",
      "Approved overtime hours and the resulting OT amount",
      "One Excel sheet per employment type",
    ],
    who: ["Supervisor"],
    role: "SUPERVISOR",
    paths: ["Workforce", "Monthly Summary"],
    steps: [
      "Open Workforce → Monthly Summary.",
      "Choose the month.",
      "Filter by site or employment type if you need a subset.",
      "Download the Excel export for the accountant.",
    ],
    note: "Only approved overtime reaches the OT Hours and OT Amount columns.",
  },
  {
    name: "Shifts and sites",
    sum: "Working hours, and the physical places where a punch is considered on-site.",
    pts: [
      "Shift start, end, grace minutes and night allowance",
      "Sites picked on a map with a geofence radius",
      "Geofence mode: block the punch, flag it, or ignore location",
    ],
    who: ["Admin"],
    role: "ADMIN",
    paths: ["Settings", "Workforce", "Shifts / Sites"],
    steps: [
      "Open Settings → Workforce. Add and Edit each open their own page.",
      "Shifts tab — add the start time, end time and grace minutes.",
      "Sites tab — set the pin, the radius, and the site's supervisor.",
      "General tab — choose the geofence mode for the whole workspace.",
    ],
    note: "A site left without a supervisor has nobody to approve its people — the screen warns you by name until you fix it.",
  },
  {
    name: "Leave types and holidays",
    sum: "What people are allowed to take, and the days on which nobody is marked absent.",
    pts: [
      "Leave types are paid, unpaid or half day, each with an annual quota",
      "Holidays apply to everyone, or to one employment type",
      "Both feed the leave calendar and the monthly summary",
    ],
    who: ["Admin"],
    role: "ADMIN",
    paths: ["Settings", "Workforce", "Leave Types / Holidays"],
    steps: [
      "Open Settings → Workforce → Leave Types.",
      "Add the type, its category and the annual quota.",
      "Switch to the Holidays tab and add the date, name and audience.",
      "Both appear on every employee's leave calendar immediately.",
    ],
    note: "Deactivate a leave type rather than deleting it — existing records still point at it.",
  },
  {
    name: "Attendance rules and notifications",
    sum: "The workspace-wide switches that decide how hours are counted and who gets told.",
    pts: [
      "Timezone, break deduction, late marks per half-day",
      "Employment types are your own list, not a fixed set",
      "Email alerts for late arrival, corrections, leave and rechecks",
    ],
    who: ["Admin"],
    role: "ADMIN",
    paths: ["Settings", "Workforce", "General"],
    steps: [
      "Open Settings → Workforce → General.",
      "Set the timezone, break deduction and weekly off days.",
      "Edit the employment types — add Intern, Contractor and so on.",
      "Switch the four email notifications on or off.",
    ],
    note: "Never rename an employment type code once employees use it — the Excel export groups its sheets by that code.",
  },
];

/* ── helpers ─────────────────────────────────────────────────────────── */
function pad(n) { return String(n).padStart(2, "0"); }

function featureSlide(f, idx) {
  const s = pres.addSlide();
  s.background = { color: PAPER };

  s.addText(`FEATURE ${pad(idx + 1)}`, {
    x: M, y: 0.42, w: 4, h: 0.3, fontSize: 11, bold: true,
    color: AMBER, charSpacing: 2, fontFace: "Calibri",
  });

  s.addText(f.name, {
    x: M, y: 0.75, w: 8.4, h: 1.0, fontSize: 33, bold: true,
    color: NAVY, fontFace: "Calibri", valign: "top",
  });

  s.addText(f.sum, {
    x: M, y: 1.82, w: 8.4, h: 0.72, fontSize: 15, color: MUTED,
    fontFace: "Calibri", lineSpacing: 21,
  });

  // Point cards
  let y = 2.72;
  f.pts.forEach((p, i) => {
    s.addShape(pres.ShapeType.roundRect, {
      x: M, y, w: 8.4, h: 0.86, fill: { color: WASH },
      line: { color: WASH, width: 0 }, rectRadius: 0.08,
    });
    s.addShape(pres.ShapeType.ellipse, {
      x: M + 0.26, y: y + 0.235, w: 0.39, h: 0.39,
      fill: { color: NAVY }, line: { color: NAVY, width: 0 },
    });
    s.addText(String(i + 1), {
      x: M + 0.26, y: y + 0.235, w: 0.39, h: 0.39, fontSize: 12, bold: true,
      color: AMBER_L, align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
    });
    s.addText(p, {
      x: M + 0.82, y: y + 0.06, w: 7.4, h: 0.74, fontSize: 14, color: INK,
      fontFace: "Calibri", valign: "middle", margin: 0,
    });
    y += 1.0;
  });

  // Who-uses-it panel
  s.addShape(pres.ShapeType.roundRect, {
    x: 9.35, y: 2.72, w: 3.35, h: 2.54, fill: { color: NAVY },
    line: { color: NAVY, width: 0 }, rectRadius: 0.08,
  });
  s.addText("WHO USES IT", {
    x: 9.62, y: 3.0, w: 2.8, h: 0.3, fontSize: 10, bold: true,
    color: AMBER, charSpacing: 1.6, fontFace: "Calibri", margin: 0,
  });
  s.addText(f.who.map((w, i) => ({
    text: w, options: { breakLine: i < f.who.length - 1 },
  })), {
    x: 9.62, y: 3.42, w: 2.8, h: 1.5, fontSize: 15, bold: true,
    color: "FFFFFF", fontFace: "Calibri", paraSpaceAfter: 8, margin: 0, valign: "top",
  });

  s.addNotes(`${f.name} — ${f.sum}`);
  return s;
}

function howToSlide(f, idx) {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  s.addText(`HOW TO  —  ${f.role}`, {
    x: M, y: 0.42, w: 8, h: 0.3, fontSize: 11, bold: true,
    color: AMBER, charSpacing: 2, fontFace: "Calibri",
  });

  s.addText(f.name, {
    x: M, y: 0.76, w: 12.1, h: 0.62, fontSize: 27, bold: true,
    color: "FFFFFF", fontFace: "Calibri", valign: "top",
  });

  // Path breadcrumb
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 1.6, w: 12.1, h: 0.74, fill: { color: NAVY2 },
    line: { color: NAVY2, width: 0 }, rectRadius: 0.08,
  });
  const crumbs = [];
  crumbs.push({ text: "PATH   ", options: { color: AMBER, bold: true, fontSize: 11, charSpacing: 1.5 } });
  f.paths.forEach((p, i) => {
    crumbs.push({ text: p, options: { color: "FFFFFF", bold: true, fontSize: 15 } });
    if (i < f.paths.length - 1) {
      crumbs.push({ text: "   ›   ", options: { color: AMBER_L, fontSize: 15 } });
    }
  });
  s.addText(crumbs, {
    x: M + 0.3, y: 1.6, w: 11.5, h: 0.74, fontFace: "Calibri",
    valign: "middle", margin: 0,
  });

  // Steps
  let y = 2.68;
  f.steps.forEach((st, i) => {
    s.addShape(pres.ShapeType.ellipse, {
      x: M + 0.04, y: y + 0.04, w: 0.42, h: 0.42,
      fill: { color: AMBER }, line: { color: AMBER, width: 0 },
    });
    s.addText(String(i + 1), {
      x: M + 0.04, y: y + 0.04, w: 0.42, h: 0.42, fontSize: 13, bold: true,
      color: NAVY, align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
    });
    s.addText(st, {
      x: M + 0.68, y, w: 11.4, h: 0.5, fontSize: 15, color: "F0F3F6",
      fontFace: "Calibri", valign: "middle", margin: 0,
    });
    y += 0.66;
  });

  // Note
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 6.28, w: 12.1, h: 0.72, fill: { color: NAVY2 },
    line: { color: NAVY2, width: 0 }, rectRadius: 0.08,
  });
  s.addText([
    { text: "NOTE   ", options: { color: AMBER, bold: true, fontSize: 10.5, charSpacing: 1.4 } },
    { text: f.note, options: { color: "DCE3EA", fontSize: 13, italic: true } },
  ], {
    x: M + 0.3, y: 6.28, w: 11.5, h: 0.72, fontFace: "Calibri",
    valign: "middle", margin: 0,
  });

  s.addNotes(`How to: ${f.name}. Path: ${f.paths.join(" > ")}`);
  return s;
}

/* ── title ───────────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addText("BPMSQUARE", {
    x: M, y: 1.5, w: 8, h: 0.4, fontSize: 13, bold: true,
    color: AMBER, charSpacing: 3.5, fontFace: "Calibri",
  });
  s.addText("Workforce Management", {
    x: M, y: 2.05, w: 11.5, h: 1.15, fontSize: 52, bold: true,
    color: "FFFFFF", fontFace: "Calibri",
  });
  s.addText("Every feature, and exactly where to find it.", {
    x: M, y: 3.25, w: 11.5, h: 0.5, fontSize: 19, color: AMBER_L, fontFace: "Calibri",
  });
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 4.35, w: 5.2, h: 1.5, fill: { color: NAVY2 },
    line: { color: NAVY2, width: 0 }, rectRadius: 0.08,
  });
  s.addText([
    { text: "How to read this deck", options: { color: AMBER, bold: true, fontSize: 12, charSpacing: 1.2, breakLine: true } },
    { text: "Each feature slide is followed by a how-to slide", options: { color: "FFFFFF", fontSize: 14, breakLine: true } },
    { text: "carrying the exact navigation path and the steps.", options: { color: "FFFFFF", fontSize: 14 } },
  ], { x: M + 0.32, y: 4.35, w: 4.6, h: 1.5, fontFace: "Calibri", valign: "middle", margin: 0, lineSpacing: 19 });
  s.addNotes("15 features, each paired with a how-to slide.");
}

/* ── module map ──────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  s.background = { color: PAPER };
  s.addText("WHERE EVERYTHING LIVES", {
    x: M, y: 0.42, w: 6, h: 0.3, fontSize: 11, bold: true,
    color: AMBER, charSpacing: 2, fontFace: "Calibri",
  });
  s.addText("Two places, split by who you are", {
    x: M, y: 0.75, w: 11.5, h: 0.7, fontSize: 33, bold: true, color: NAVY, fontFace: "Calibri",
  });

  const cols = [
    {
      head: "Sidebar › Workforce",
      sub: "Day-to-day work",
      rows: [
        ["My Workforce", "Everyone"],
        ["Live board", "Supervisor"],
        ["Employees", "Supervisor"],
        ["Corrections", "Supervisor"],
        ["Roster", "Supervisor"],
        ["Leave & Holidays", "Supervisor"],
        ["Monthly Summary", "Supervisor"],
      ],
    },
    {
      head: "Settings › Workforce",
      sub: "Configuration, admin only",
      rows: [
        ["General", "Rules, punch types, OT rate"],
        ["Sites", "Locations + who supervises each"],
        ["Shifts", "Working hours and grace"],
        ["Leave Types", "Categories and quotas"],
        ["Holidays", "Company calendar"],
      ],
    },
  ];

  cols.forEach((col, ci) => {
    const x = ci === 0 ? M : 6.95;
    const w = 6.0;
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 1.72, w, h: 0.86, fill: { color: NAVY },
      line: { color: NAVY, width: 0 }, rectRadius: 0.08,
    });
    s.addText([
      { text: col.head, options: { color: "FFFFFF", bold: true, fontSize: 16, breakLine: true } },
      { text: col.sub, options: { color: AMBER_L, fontSize: 12 } },
    ], { x: x + 0.3, y: 1.72, w: w - 0.6, h: 0.86, fontFace: "Calibri", valign: "middle", margin: 0 });

    let y = 2.78;
    col.rows.forEach((r) => {
      s.addShape(pres.ShapeType.roundRect, {
        x, y, w, h: 0.56, fill: { color: WASH },
        line: { color: WASH, width: 0 }, rectRadius: 0.06,
      });
      s.addText(r[0], {
        x: x + 0.3, y, w: w * 0.45, h: 0.56, fontSize: 13.5, bold: true,
        color: INK, fontFace: "Calibri", valign: "middle", margin: 0,
      });
      s.addText(r[1], {
        x: x + w * 0.48, y, w: w * 0.48, h: 0.56, fontSize: 12, color: MUTED,
        fontFace: "Calibri", valign: "middle", align: "right", margin: 0,
      });
      y += 0.64;
    });
  });
  s.addNotes("Day-to-day work lives under the Workforce sidebar group; all configuration lives under Settings.");
}

/* ── feature + how-to pairs ──────────────────────────────────────────── */
FEATURES.forEach((f, i) => { featureSlide(f, i); howToSlide(f, i); });

/* ── roles matrix ────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  s.background = { color: PAPER };
  s.addText("PERMISSIONS", {
    x: M, y: 0.42, w: 6, h: 0.3, fontSize: 11, bold: true,
    color: AMBER, charSpacing: 2, fontFace: "Calibri",
  });
  s.addText("Who can do what", {
    x: M, y: 0.75, w: 11.5, h: 0.7, fontSize: 33, bold: true, color: NAVY, fontFace: "Calibri",
  });
  s.addText("Enforced on the server, not just hidden in the interface.", {
    x: M, y: 1.5, w: 11.5, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Calibri",
  });

  const rows = [
    ["Action", "Employee", "Site supervisor", "Manager", "Admin"],
    ["Punch, own timesheet, apply for leave", "Yes", "Yes", "Yes", "Yes"],
    ["See the people at the site(s) you supervise", "No", "Yes", "Yes", "Yes"],
    ["See a site you don't supervise", "No", "No", "Yes*", "Yes"],
    ["Approve overtime, corrections and leave", "No", "Yes", "Yes", "Yes"],
    ["Approve your OWN request", "No", "No", "No", "No"],
    ["Plan the roster, manage employees", "No", "Yes", "Yes", "Yes"],
    ["Monthly summary and Excel export", "No", "Yes", "Yes", "Yes"],
    ["Shifts, sites, leave types, attendance rules", "No", "No", "No", "Yes"],
  ];

  const colX = [M, 6.15, 7.75, 9.75, 11.35];
  const colW = [5.5, 1.6, 2.0, 1.6, 1.35];
  let y = 2.05;
  rows.forEach((r, ri) => {
    const head = ri === 0;
    s.addShape(pres.ShapeType.roundRect, {
      x: M, y, w: 12.1, h: 0.5,
      fill: { color: head ? NAVY : (ri % 2 ? WASH : PAPER) },
      line: { color: head ? NAVY : LINE, width: head ? 0 : 0.5 },
      rectRadius: 0.05,
    });
    r.forEach((cell, ci) => {
      const yes = cell.startsWith("Yes");
      const no = cell === "No";
      s.addText(cell, {
        x: colX[ci], y, w: colW[ci], h: 0.5,
        fontSize: head ? 11.5 : 12,
        bold: head || ci === 0 || yes,
        color: head ? "FFFFFF" : (yes ? "1E7A4C" : no ? "A03A3A" : INK),
        align: ci === 0 ? "left" : "center",
        valign: "middle", fontFace: "Calibri",
        margin: 0, inset: ci === 0 ? 0.3 : 0,
      });
    });
    y += 0.56;
  });

  s.addText("*  A manager reaches only the sites beneath them — not another manager's branch. A tenant admin sits above the whole tree.", {
    x: M, y: y + 0.08, w: 12.1, h: 0.34, fontSize: 11.5, italic: true,
    color: MUTED, fontFace: "Calibri", margin: 0,
  });

  s.addNotes("Scope follows the site you are assigned to, per date. Nobody approves their own request.");
}

/* ── closing ─────────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addText("THE SHORT VERSION", {
    x: M, y: 1.35, w: 8, h: 0.3, fontSize: 11, bold: true,
    color: AMBER, charSpacing: 2.4, fontFace: "Calibri",
  });
  s.addText("Three things worth remembering", {
    x: M, y: 1.75, w: 11.5, h: 0.85, fontSize: 38, bold: true, color: "FFFFFF", fontFace: "Calibri",
  });

  const finals = [
    ["Attendance is never edited", "Every fix adds a new event and supersedes the old one, so the history always survives."],
    ["Overtime is separate, and approved", "Punch out of the shift first. Nothing reaches pay until a supervisor approves it."],
    ["You handle your own site", "Each site has one supervisor; a manager covers the sites beneath them. Nobody approves their own request."],
  ];
  let y = 3.05;
  finals.forEach((f, i) => {
    s.addShape(pres.ShapeType.roundRect, {
      x: M, y, w: 12.1, h: 1.06, fill: { color: NAVY2 },
      line: { color: NAVY2, width: 0 }, rectRadius: 0.08,
    });
    s.addShape(pres.ShapeType.ellipse, {
      x: M + 0.32, y: y + 0.31, w: 0.44, h: 0.44,
      fill: { color: AMBER }, line: { color: AMBER, width: 0 },
    });
    s.addText(String(i + 1), {
      x: M + 0.32, y: y + 0.31, w: 0.44, h: 0.44, fontSize: 13, bold: true,
      color: NAVY, align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
    });
    s.addText([
      { text: f[0], options: { color: "FFFFFF", bold: true, fontSize: 16, breakLine: true } },
      { text: f[1], options: { color: "C6D0DA", fontSize: 13 } },
    ], { x: M + 1.0, y, w: 10.8, h: 1.06, fontFace: "Calibri", valign: "middle", margin: 0, lineSpacing: 18 });
    y += 1.2;
  });
  s.addNotes("Close here; the API reference and Postman collection cover the machine-facing side.");
}

pres.writeFile({ fileName: "/home/user/bpmsquare-app/docs/qa/BPMSquare_WFM_Feature_Guide.pptx" })
  .then((f) => console.log("wrote", f));
