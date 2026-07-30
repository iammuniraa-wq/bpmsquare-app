export default function ComingSoon({ size = "sm" }: { size?: "sm" | "xs" }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: size === "xs" ? 9 : 10,
      fontWeight: 700, letterSpacing: 0.4,
      color: "var(--amberink)", background: "var(--amberbg)",
      border: "1px solid var(--amberline)", borderRadius: 6,
      padding: size === "xs" ? "1px 5px" : "2px 7px",
      whiteSpace: "nowrap", flexShrink: 0,
    }}>
      ◎ Coming Soon
    </span>
  );
}
