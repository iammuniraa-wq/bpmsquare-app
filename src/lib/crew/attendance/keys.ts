// The agent's identity. It is 'attendance' everywhere the shared contract and the design's migration use it
// (AgentKey in src/lib/crew/types.ts, crew_agent_settings.agent_key, dedupe keys, the meter surface). The task brief called the
// agent 'attendance_anomalies'; that is its title in the product, not its key.

export const ATTENDANCE_AGENT_KEY = "attendance";
export const ATTENDANCE_TITLE = "Attendance Anomalies";
/** ai_usage_log.surface (design 3.8). */
export const ATTENDANCE_METER_SURFACE = "crew:attendance";
