// A rules-only stand-in for the model: it turns the digest's candidates into a submit_findings payload the way a careful model
// should. It exists so the whole deterministic chain (fixtures -> adapters -> detectors -> digest -> submission -> validator ->
// scoring -> gate) is exercised without a model, and so a fixture that no sensible answer could satisfy fails in CI.
// It is NOT a fallback for the model in production.

import type { Candidate } from "../detectors";
import type { SiteDigest } from "../digest";
import type { ActionCode, ExplanationCode, Submission, SubmittedFinding, SubmittedProposal } from "../submission";

/** A late cluster whose middle late-by is this small is clock noise, not a pattern (design 5.8: "dropping 2-3 minute noise"). */
export const NOISE_LATE_MINUTES = 3;

const EXPLAIN: Record<string, ExplanationCode[]> = {
  "late_cluster/site": ["shift_start_or_grace_setting", "transport_or_gate_process"],
  "late_cluster/person": ["transport_or_gate_process", "roster_or_site_change_not_recorded"],
  "missing_out_cluster/site": ["device_or_network_problem", "process_or_procedure_change"],
  "missing_out_cluster/person": ["device_or_network_problem", "end_of_shift_handover_routine"],
  "far_punches/site": ["site_boundary_or_pin_setting", "phone_location_or_gps_problem"],
  "far_punches/person": ["approved_work_elsewhere_not_rostered", "phone_location_or_gps_problem"],
};

const ACTIONS: Record<string, ActionCode[]> = {
  "late_cluster/site": ["review_shift_setting", "nothing"],
  "late_cluster/person": ["keep_an_eye_next_week", "nothing"],
  "missing_out_cluster/site": ["check_device_or_network", "ask_for_recheck"],
  "missing_out_cluster/person": ["ask_for_recheck", "nothing"],
  "far_punches/site": ["check_site_boundary_setting", "nothing"],
  "far_punches/person": ["ask_for_recheck", "nothing"],
};

function titleAndObserved(c: Candidate, i: number): { title: string; observed: string } {
  const p = `s1.candidates[${i}]`;
  if (c.family === "late_cluster" && c.level === "site") {
    return {
      title: `Late check-ins cluster on {{${p}.days|dates}} at this site`,
      observed: `{{${p}.people_affected}} people checked in late on those days, out of up to {{${p}.headcount}} expected.`,
    };
  }
  if (c.family === "late_cluster") {
    return { title: `${c.person} checked in late on days the rest of the site did not`, observed: `{{${p}.count}} late check-ins in the last {{${p}.window_days}} shift-days: {{${p}.days|dates}}.` };
  }
  if (c.family === "missing_out_cluster" && c.level === "site") {
    return {
      title: `Missing check-outs cluster on {{${p}.days|dates}} at this site`,
      observed: `{{${p}.people_affected}} of the {{${p}.headcount}} people present have a check-in and no check-out.`,
    };
  }
  if (c.family === "missing_out_cluster") {
    return { title: `${c.person} has several days with no check-out`, observed: `{{${p}.count}} days in the last {{${p}.window_days}} shift-days: {{${p}.days|dates}}.` };
  }
  if (c.level === "site") {
    return {
      title: "Several people punch just outside the site boundary",
      observed: `{{${p}.count}} punches by {{${p}.people_affected}} people were outside the boundary over {{${p}.window_days}} shift-days.`,
    };
  }
  return { title: `${c.person} has punches far from the site`, observed: `{{${p}.count}} punches well outside the boundary on {{${p}.days|dates}}.` };
}

export function referenceSubmission(digest: SiteDigest): Submission {
  const findings: SubmittedFinding[] = [];
  const proposals: SubmittedProposal[] = [];
  digest.candidates.forEach((c, i) => {
    if (c.family === "late_cluster" && c.level === "site" && c.median_late_minutes !== null && c.median_late_minutes <= NOISE_LATE_MINUTES) return;
    const key = `${c.family}/${c.level}`;
    const { title, observed } = titleAndObserved(c, i);
    const index = findings.length;
    findings.push({
      candidate_id: c.id, kind: c.family, level: c.level, severity: "review",
      subject: c.level === "person" ? { type: "person", alias: c.person as string } : { type: "site", alias: c.site },
      title_tmpl: title, observed_tmpl: observed,
      explanations: EXPLAIN[key].map((code) => ({ code, text_tmpl: code.replace(/_/g, " ") })),
      actions: ACTIONS[key].map((code) => ({ code, text_tmpl: code.replace(/_/g, " ") })),
      evidence: [
        { step: "s1", path: `candidates[${i}]`, label: "candidate" },
        { step: "s1", path: `candidates[${i}].${c.level === "site" ? "people_affected" : "count"}`, label: "count" },
        { step: "s1", path: `candidates[${i}].days`, label: "days" },
      ],
      gaps: [],
    });
    if (c.family === "missing_out_cluster") {
      proposals.push({
        action: "wfm.recheck", finding_index: index, target_aliases: c.level === "person" ? [c.person as string] : c.members.slice(0, 25),
        message_tmpl: `Your check-out is missing on {{s1.candidates[${i}].days|dates}}. Please look at those days and, if anything needs correcting, send a correction request.`,
      });
    } else if (c.family === "far_punches" && c.level === "person") {
      proposals.push({
        action: "wfm.recheck", finding_index: index, target_aliases: [c.person as string],
        message_tmpl: `Your punches on {{s1.candidates[${i}].days|dates}} show a location far from the site. Please check them and, if anything needs correcting, send a correction request.`,
      });
    } else if (c.level === "site") {
      proposals.push({ action: "site_note", finding_index: index, message_tmpl: "A pattern showed up at this site. Worth a look at the setting behind it." });
    }
  });
  return {
    findings, proposals,
    nothing_to_report: findings.length === 0 ? (digest.candidates.length === 0 ? "No pattern cleared the threshold." : "The candidates look like small clock differences, not a pattern.") : null,
  };
}
