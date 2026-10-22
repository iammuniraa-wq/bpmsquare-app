// Every reason a journey step did not happen, or has not happened yet, in one
// place: the code stored on a run or a step row, the plain sentence a person
// reads, and the group the journey page counts it under. Pure.

export const REASON_GROUPS = {
  consent: "No consent",
  quiet: "Quiet hours",
  cap: "Daily limit",
  trouble: "Open urgent case",
  person: "Nobody to contact",
  setup: "Needs setting up",
  error: "Problem",
} as const;
export type ReasonGroup = keyof typeof REASON_GROUPS;

type Def = { label: string; group: ReasonGroup };

export const REASONS: Record<string, Def> = {
  // consent: mirrors ContactReason in lib/marketing/consent.ts
  no_consent: { label: "No consent on record for this topic", group: "consent" },
  withdrawn: { label: "The person withdrew consent", group: "consent" },
  do_not_contact: { label: "Marked do not contact", group: "consent" },
  suppressed: { label: "The address is suppressed", group: "consent" },
  account_opted_out: { label: "The company opted out of marketing email", group: "consent" },
  contact_not_found: { label: "The person could not be found", group: "person" },
  unavailable: { label: "Consent could not be checked, so nothing was sent", group: "error" },
  // timing
  quiet_hours: { label: "Waiting for quiet hours to end", group: "quiet" },
  weekly_off: { label: "Waiting for the weekly day off to pass", group: "quiet" },
  daily_cap: { label: "Already had a journey email in the last 24 hours", group: "cap" },
  account_in_trouble: { label: "The company has an open urgent case or an overdue invoice", group: "trouble" },
  // person
  no_contact: { label: "No contact person on the record", group: "person" },
  no_email: { label: "The person has no email address", group: "person" },
  no_language: { label: "The newsletter has no language this person can read", group: "setup" },
  // setup
  no_version: { label: "No newsletter was chosen for this step", group: "setup" },
  version_missing: { label: "The chosen newsletter no longer exists", group: "setup" },
  studio_off: { label: "The Newsletter Studio is not switched on", group: "setup" },
  not_configured: { label: "Email sending is not set up yet", group: "setup" },
  journey_changed: { label: "The journey was changed and this step no longer exists", group: "setup" },
  journey_archived: { label: "The journey was archived", group: "setup" },
  // WhatsApp (lib/marketing/whatsapp/reasons.ts has the full sentences)
  template_not_approved: { label: "The WhatsApp template is not approved yet", group: "setup" },
  template_missing: { label: "The chosen WhatsApp template no longer exists", group: "setup" },
  no_template: { label: "No WhatsApp template was chosen for this step", group: "setup" },
  no_identity: { label: "No WhatsApp number is set up for this workspace yet", group: "setup" },
  module_off: { label: "WhatsApp is not switched on for this workspace", group: "setup" },
  no_phone: { label: "The person has no phone number WhatsApp can use", group: "person" },
  weekly_cap: { label: "Already had a marketing WhatsApp message this week", group: "cap" },
  dry_run: { label: "Logged only: this workspace does not send to real numbers", group: "error" },
  // result
  sent: { label: "Sent", group: "error" },
  send_failed: { label: "The email could not be sent", group: "error" },
  done: { label: "Done", group: "error" },
  scheduled: { label: "Waiting", group: "error" },
  no_owner: { label: "Nobody owns this company yet, so the task is unassigned", group: "person" },
  already_sent: { label: "This email had already gone out", group: "error" },
  finished: { label: "Finished the journey", group: "error" },
};

export function reasonLabel(code: string | null | undefined): string {
  if (!code) return "";
  return REASONS[code]?.label ?? code.replace(/_/g, " ");
}

export function reasonGroup(code: string | null | undefined): ReasonGroup {
  return (code && REASONS[code]?.group) || "error";
}

/** The groups the journey page offers as "skipped because ...", in the order they are shown. */
export const SKIP_GROUPS: ReasonGroup[] = ["consent", "quiet", "cap", "trouble", "person", "setup"];
