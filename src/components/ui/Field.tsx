import { c } from "@/lib/theme";

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};

/**
 * Label above the control, hint or error below it.
 *
 * With `htmlFor` the label is a sibling of the control. Without it the label
 * wraps the control, which associates them with no id plumbing -- right for
 * the common one-control field; give `htmlFor` for anything with several
 * controls or buttons inside.
 */
export default function Field({
  label, hint, error, required, htmlFor, children, style,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const text = (
    <span style={labelStyle}>
      {label}
      {required && <span aria-hidden="true"> *</span>}
    </span>
  );
  return (
    <div style={{ marginBottom: 16, ...style }}>
      {htmlFor ? (
        <>
          <label htmlFor={htmlFor} style={{ display: "block" }}>{text}</label>
          {children}
        </>
      ) : (
        <label style={{ display: "block" }}>
          {text}
          {children}
        </label>
      )}
      {error ? (
        <div role="alert" style={{ marginTop: 5, fontSize: 12, color: "var(--err-ink)" }}>{error}</div>
      ) : hint ? (
        <div style={{ marginTop: 5, fontSize: 12, color: c.hint }}>{hint}</div>
      ) : null}
    </div>
  );
}
