// The AgentDefinition of Attendance Anomalies (design 2, 5). Pure data plus plan(): the runner owns the loop, the budget, the
// persistence and the approval gate. This definition has no way to send, write or execute anything.

import type { AgentDefinition } from "./contract";
import { ATTENDANCE_AGENT_KEY } from "./keys";
import { planAttendance, type PlanCtx } from "./plan";
import { ATTENDANCE_GOAL, ATTENDANCE_PROMPT_VERSION } from "./prompt";
import { PROPOSAL_ACTIONS, SUBMISSION_SCHEMA } from "./submission";
import { ATTENDANCE_TOOLS } from "./tools";

export const attendanceAnomalies: AgentDefinition<PlanCtx> = {
  key: ATTENDANCE_AGENT_KEY,
  title: "Attendance Anomalies",
  goal: ATTENDANCE_GOAL,
  prompt_version: ATTENDANCE_PROMPT_VERSION,
  requires: { features: ["crew", "crew_attendance", "wfm"] },
  // Schedule only: attendance has no events (design 5.2). The weekly summary pass belongs to slice 4.
  triggers: { schedule: [{ at: "02:00", covers: "previous_shift_day" }] },
  plan: planAttendance,
  tools: ATTENDANCE_TOOLS,
  actions: [...PROPOSAL_ACTIONS],
  outputSchema: SUBMISSION_SCHEMA,
  limits: { maxTurns: 4, maxToolCalls: 6, maxTokensPerRun: 24_000, deadlineMs: 90_000 },
  tier: "small",
  // Buddy-punch and holiday-bridging are not agent families (design 5.6); they are not offered here at all.
  defaults: { sensitivity: "balanced", families: { late_cluster: true, missing_out_cluster: true, far_punches: true } },
  autonomy: "propose",
  evalSet: "src/lib/crew/attendance/eval/cases",
};
