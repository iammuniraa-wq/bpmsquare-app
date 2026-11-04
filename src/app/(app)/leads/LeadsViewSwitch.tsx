import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";

/** All leads (status, source, convert) or the Scored view (score, stage, owner, respond-by): two views of the same leads. */
export default function LeadsViewSwitch({ active }: { active: "all" | "scored" }) {
  const item = (id: "all" | "scored", label: string, href: string) => (
    <Link
      key={id} href={href} aria-current={active === id ? "page" : undefined}
      style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 14px", fontSize: 13, textDecoration: "none", fontWeight: active === id ? 700 : 500, color: active === id ? "#fff" : c.ink, background: active === id ? c.accent : c.panel }}
    >{label}</Link>
  );
  return (
    <div role="group" aria-label="Leads view" style={{ display: "inline-flex", border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
      {item("all", "All leads", ROUTES.leads)}
      {item("scored", "Scored", `${ROUTES.leads}?view=scored`)}
    </div>
  );
}
