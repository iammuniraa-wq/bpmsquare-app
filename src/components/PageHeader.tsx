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
            // --tenant-accent is server-rendered from tenant.accent_color in (app)/layout.tsx —
            // the same source Sidebar uses, so this bar always matches the sidebar highlight.
            borderLeft: "3px solid var(--tenant-accent, #378ADD)",
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
      {/* The decorative avatar that used to sit here hardcoded "VP" (a
          prototype-era Vikas Pioneers leftover, shown to every tenant) --
          removed rather than dynamized: it carried no information. */}
      {action && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{action}</div>}
    </div>
  );
}
