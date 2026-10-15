import { c } from "@/lib/theme";

/** A real empty state: says what is missing and what to do about it. */
export default function EmptyState({
  title, text, action,
}: {
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ textAlign: "center", padding: "40px 24px" }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink }}>{title}</div>
      {text && <div style={{ fontSize: 13, color: c.muted, marginTop: 6, maxWidth: 420, marginInline: "auto" }}>{text}</div>}
      {action && <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>{action}</div>}
    </div>
  );
}
