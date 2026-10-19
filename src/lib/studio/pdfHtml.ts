import { schedule, studySummary, phaseTicks, lanesOf } from "./summary";
import {
  AREA_META, CHANGE_KIND_LABEL, CONFIDENCE_LABEL, EFFORT_LABEL, OWNER_LABEL, PHASE_LABEL, PHASES, RATING_LABEL,
  type StudyBundle,
} from "./types";

// The "Talk to us" package as a printable document (PDF through lib/pdf/htmlToPdf).
// Built from the stored rows by code, fully escaped (a client typed most of this),
// and stamped "Indicative" on every page: the PDF is something a client forwards
// internally, never a contract (doc section 11).

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

const RATING_COLOUR: Record<string, string> = {
  standard: "#1d7a45", needs_setup: "#1f5fa8", partly: "#9a5a0b", not_covered: "#b3402f", needs_review: "#5d6b7c", coming: "#5d6b7c",
};

export function buildStudyHtml(
  bundle: StudyBundle,
  opts: { version: number; labelOf: (capabilityId: string) => string; reviewed: boolean; generatedOn: string },
): string {
  const { study, steps, fit, changes, tasks, comments } = bundle;
  const sum = studySummary({ study, steps, fit, changes, tasks, comments });
  const phases = schedule(study, tasks);
  const ticks = phaseTicks(comments);
  const stepName = new Map(steps.map((s) => [s.id, s]));
  const fitByStep = new Map(fit.map((f) => [f.step_id, f]));
  const lanes = lanesOf(steps, study.lanes);

  const fitRows = AREA_ORDER(steps).map((area) => {
    const rows = steps.filter((s) => s.area === area).map((s) => {
      const f = fitByStep.get(s.id);
      const rating = f?.rating ?? "needs_review";
      const covers = f && f.capability_ids.length ? f.capability_ids.map((id) => esc(opts.labelOf(id))).join(", ") : "Not in BPMSquare today";
      return `<tr><td><b>${esc(s.name)}</b><div class="m">${esc(s.lane)}${s.how_today ? ` · today: ${esc(s.how_today)}` : ""}</div></td>
        <td><span class="pill" style="color:${RATING_COLOUR[rating]}">${esc(RATING_LABEL[rating])}</span></td>
        <td>${covers}<div class="m">${esc(f?.why ?? "")}</div><div class="m">${esc(f ? CONFIDENCE_LABEL[f.confidence] : "")}</div></td></tr>`;
    }).join("");
    return `<tr class="area"><td colspan="3">${esc(AREA_META[area].label)}</td></tr>${rows}`;
  }).join("");

  const changeRows = changes.filter((c) => c.kept).map((c) => `
    <div class="card"><div class="k"><span class="pill">${esc(CHANGE_KIND_LABEL[c.kind])}</span><span class="m">${esc(EFFORT_LABEL[c.effort_band])} (indicative)</span></div>
    <b>${esc(c.title)}</b><div>${esc(c.plain)}</div>
    ${c.alternative ? `<div class="m">Without it: ${esc(c.alternative)}</div>` : ""}
    <div class="m">For: ${esc(c.step_ids.map((id) => stepName.get(id)?.name).filter(Boolean).join(" · ") || "your own request")}</div></div>`).join("");

  const planBlocks = PHASES.filter((p) => tasks.some((t) => t.phase === p)).map((p) => {
    const span = phases.find((x) => x.phase === p);
    const mine = tasks.filter((t) => t.phase === p);
    const note = comments.filter((c) => c.phase === p && c.task_id === null && c.text).map((c) => `<div class="m">Your comment: ${esc(c.text)}</div>`).join("");
    return `<div class="phase"><h3>${esc(PHASE_LABEL[p])} <span class="m">${span ? `${esc(fmtDate(span.start))} to ${esc(fmtDate(span.end))} · ${span.days} working days` : ""}${ticks.has(p) ? " · ticked: looks right" : ""}</span></h3>
      <table><tbody>${mine.map((t) => `<tr><td>${t.milestone ? "&#9670; " : ""}${esc(t.name)}</td><td>${esc(OWNER_LABEL[t.owner])}</td><td class="r">${t.duration_days} d</td></tr>`).join("")}</tbody></table>${note}</div>`;
  }).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(study.name)}</title><style>
    *{box-sizing:border-box} body{font:12px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#17212e;margin:0;padding-bottom:26px}
    h1{font-size:22px;margin:0 0 2px} h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #dde3ea;padding-bottom:4px} h3{font-size:13px;margin:12px 0 4px}
    .m{color:#5d6b7c;font-size:11px;font-weight:400} .r{text-align:right;white-space:nowrap}
    table{width:100%;border-collapse:collapse} td{padding:5px 6px;border-bottom:1px solid #eef1f5;vertical-align:top}
    tr.area td{background:#f6f8fb;font-weight:700;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em;color:#5d6b7c}
    .pill{display:inline-block;font-weight:700;font-size:11px;white-space:nowrap}
    .sum{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.sum div{background:#f6f8fb;border-radius:8px;padding:8px 12px;min-width:120px}.sum b{display:block;font-size:17px}
    .card{border:1px solid #dde3ea;border-radius:8px;padding:8px 10px;margin:6px 0;break-inside:avoid}.k{display:flex;justify-content:space-between}
    .phase{break-inside:avoid;margin-bottom:8px}
    .stamp{position:fixed;left:0;right:0;bottom:0;text-align:center;font-size:10px;color:#9a5a0b;background:#fff;padding:4px 0;border-top:1px solid #dde3ea}
    .banner{background:${opts.reviewed ? "#e3f4ea" : "#fdf0dc"};color:${opts.reviewed ? "#1d7a45" : "#9a5a0b"};border-radius:8px;padding:6px 10px;font-weight:600;margin:8px 0}
  </style></head><body>
  <div class="stamp">Indicative plan: confirmed after the BPMSquare review call</div>
  <h1>${esc(study.name)}</h1>
  <div class="m">${esc(study.ref ?? "")} · version ${opts.version} · ${esc(opts.generatedOn)}${study.contact_name ? ` · for ${esc(study.contact_name)}` : ""}</div>
  <div class="banner">${opts.reviewed ? "Reviewed by BPMSquare." : "Draft: BPMSquare reviews this before it becomes a proposal."}</div>
  ${study.summary ? `<p>${esc(study.summary)}</p>` : ""}
  <div class="sum">
    <div><span class="m">Steps mapped</span><b>${sum.steps}</b></div>
    <div><span class="m">Roles</span><b>${sum.roles}</b></div>
    <div><span class="m">Standard or setup</span><b>${sum.standardOrSetup} of ${sum.steps}</b></div>
    <div><span class="m">Need a change</span><b>${sum.needChange}</b></div>
    <div><span class="m">Plan</span><b>${sum.planDays} working days</b></div>
  </div>
  <h2>How BPMSquare fits</h2>
  <table><tbody>${fitRows}</tbody></table>
  ${study.noticed.length ? `<h3>Things we noticed</h3>${study.noticed.map((n) => `<div>&bull; ${esc(n)}</div>`).join("")}` : ""}
  <h2>What we would change</h2>
  ${changeRows || "<p class=\"m\">Nothing to change: every step is standard or needs only setup.</p>"}
  <h2>Your plan</h2>
  ${planBlocks || "<p class=\"m\">No plan yet.</p>"}
  <p class="m" style="margin-top:14px">Roles described: ${esc(lanes.join(", ") || "none")}. Effort is shown as Small, Medium or Large and is indicative; it is not a price.</p>
  </body></html>`;
}

function AREA_ORDER(steps: StudyBundle["steps"]): (keyof typeof AREA_META)[] {
  const seen: (keyof typeof AREA_META)[] = [];
  for (const s of steps) if (!seen.includes(s.area)) seen.push(s.area);
  return seen;
}
