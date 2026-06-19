// VeveyCRM domain model — the Account is the hub; everything carries account_id.
// Mirrors the LOCKED data model in PROJECT.md §3.

export type AccountType = "oem" | "direct" | "end_customer";

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  city: string | null;
  phone: string | null;
  email: string | null;
  // The OEM that referred this account (when type = end_customer).
  referred_by_account_id: string | null;
  created_at: string;
};

export type Contact = {
  id: string;
  account_id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
};

export type Site = {
  id: string;
  account_id: string;
  label: string;
  address: string | null;
};

export type Asset = {
  id: string;
  account_id: string;
  kind: "motor" | "transformer" | "pump" | "generator" | "panel";
  name: string;
  rating: string | null; // e.g. "75 kW · 415V · 1480 rpm"
  serial: string | null;
};

export type Contract = {
  id: string;
  account_id: string;
  ref: string;
  // The OEM/holder billed for AMC-covered jobs.
  holder_account_id: string | null;
  status: "active" | "expired" | "draft";
  start_date: string | null;
  end_date: string | null;
  value: number | null;
};

export type LeadStatus = "new" | "inspecting" | "quoted" | "won" | "lost";

export type Lead = {
  id: string;
  account_id: string;
  title: string;
  source: "oem_referral" | "amc" | "direct";
  status: LeadStatus;
  created_at: string;
};

export type Quote = {
  id: string;
  account_id: string;
  ref: string;
  status: "draft" | "sent" | "approved" | "rejected";
  total: number;
  created_at: string;
};

export type WorkOrderStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "invoiced";

// Every work order is authorized by exactly one commercial wrapper:
// a quote (billable) or a contract (AMC-covered). PROJECT.md §3.
export type WorkOrder = {
  id: string;
  account_id: string;
  ref: string;
  asset_id: string | null;
  technician_id: string | null;
  authorized_by: { kind: "quote"; id: string } | { kind: "contract"; id: string };
  status: WorkOrderStatus;
  scheduled_for: string | null;
};

export type Invoice = {
  id: string;
  account_id: string;
  ref: string;
  work_order_id: string | null;
  status: "draft" | "sent" | "paid" | "overdue";
  total: number;
  issued_at: string | null;
};

export type Technician = {
  id: string;
  name: string;
  skills: string | null;
};

// Unified timeline — one job visibly travels across pillars. PROJECT.md §4.
export type Activity = {
  id: string;
  account_id: string;
  pillar: "marketing" | "sales" | "service" | "field" | "finance";
  text: string;
  at: string;
};
