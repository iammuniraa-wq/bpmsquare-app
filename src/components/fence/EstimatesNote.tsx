import Link from "next/link";
import { ROUTES } from "@/lib/constants";

/**
 * One line on the old Fence projects screens, shown only to a workspace that also has the
 * Estimates module: new fence jobs are estimated there (the Chain-link fence template).
 * Nothing about the old screens changes otherwise.
 */
export default function EstimatesNote({ compact = false }: { compact?: boolean }) {
  const text = (
    <>
      Fence estimates now live under Estimates.{" "}
      <Link href={`${ROUTES.estimateNew}`} style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}>Start one there</Link>
    </>
  );
  if (compact) {
    return <div role="note" style={{ flex: "none", padding: "6px 16px", background: "var(--accentbg)", color: "var(--accent)", fontSize: 12.5 }}>{text}</div>;
  }
  return <div role="note" className="est-note" style={{ marginBottom: 12 }}>{text}</div>;
}
