import { c } from "@/lib/theme";

// Page-header convention: paddingLeft + accent left border. Pass `action` for a top-right CTA.
export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
      }}
    >
      <div>
        <h1
          style={{
            fontSize: 19,
            margin: 0,
            paddingLeft: 12,
            borderLeft: "3px solid var(--vevey-accent, #378ADD)",
            fontWeight: 600,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontSize: 12, color: c.muted, marginTop: 3, paddingLeft: 12 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {action}
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: c.accentbg,
            color: "#0c447c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          VP
        </div>
      </div>
    </div>
  );
}
