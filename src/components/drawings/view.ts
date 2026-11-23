import type { RevisionRow, RevisionStatus } from "@/lib/drawings/types";
import type { PillarKey } from "@/lib/theme";

// Shapes and small helpers shared by the register's screens (server pages build them, client panels read them).

export type RevisionView = RevisionRow & {
  submitted_by_name: string | null;
  released_by_name: string | null;
  /** What THIS signed-in person may do with it, decided on the server from the type (the routes decide again when it is pressed). */
  canRelease: boolean;
  canReturn: boolean;
  canEdit: boolean;
  elementCount: number;
};

export const STATUS_TONE: Record<RevisionStatus, PillarKey> = { draft: "blue", in_review: "amber", released: "green", superseded: "purple" };

export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

export const fmtBytes = (n: number | null | undefined): string => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const fmtNum = (n: number | null | undefined, digits = 2): string => (n == null ? "" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: digits }));
