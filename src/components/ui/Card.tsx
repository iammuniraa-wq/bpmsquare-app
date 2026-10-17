
// Same surface as `cardStyle` in Shell.tsx (three theme variables). Declared
// here rather than imported because Shell is a "use client" module, and a
// server page cannot read a plain constant out of one.
export const CARD_SURFACE: React.CSSProperties = {
  background: "var(--card-bg)",
  border: "1px solid var(--line)",
  borderRadius: "var(--card-radius)",
  boxShadow: "var(--card-shadow)",
};

/**
 * A titled surface. `action` is the one quiet text action allowed in the
 * header's right corner ("Add", "Edit", "View all") -- a Button with
 * variant="quiet", or a Link.
 */
export default function Card({
  title, action, padding = 16, children, style,
}: {
  title?: string;
  action?: React.ReactNode;
  padding?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section style={{ ...CARD_SURFACE, padding, minWidth: 0, ...style }}>
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          {title ? (
            <h2 className="bpm-t-section">{title}</h2>
          ) : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
