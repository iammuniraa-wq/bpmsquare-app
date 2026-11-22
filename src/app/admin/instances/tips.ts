// Explanations for the Instances screen, kept here so a test can hold them to the two-sentence limit (docs/design/ux-simplification.md).
export const INSTANCE_TIPS = {
  page: "An instance is one database with its own app deployment. Open admin signs you into that instance's own admin for two minutes.",
  tenants: "Each row is as of that instance's last refresh. Open admin lands on the tenant in the instance's own admin.",
  slug: "Must match INSTANCE_SLUG on that deployment. Lowercase letters, digits and hyphens.",
  baseUrl: "https only, and it must be a public address. The console signs its requests to this origin.",
  dbHost: "For your own records. The console never connects to the database.",
  status: "Planned instances are listed but never contacted. Only an active instance can be opened.",
} as const;
