import { cloneElement, isValidElement, useId } from "react";
import InfoTip from "./InfoTip";

/**
 * Label above the control, hint or error below it.
 *
 * With `htmlFor` the label is a sibling of the control. Without it the label
 * wraps the control, which associates them with no id plumbing -- right for
 * the common one-control field; give `htmlFor` for anything with several
 * controls or buttons inside.
 *
 * `info` is the explanation, shown behind an "i" after the label. `hint` is
 * only for a constraint of a few words under the control ("PNG, JPG · max
 * 2 MB"); explanations never print (docs/design/ux-simplification.md §2a).
 */
export default function Field({
  label, hint, info, error, required, htmlFor, children, style, guide,
}: {
  label: string;
  hint?: string;
  info?: React.ReactNode;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** A stable data-guide id (e.g. account.field.name) so the assistant can point at this field; see src/lib/assistant/screens. */
  guide?: string;
}) {
  const autoId = useId();
  const text = (
    <span className="bpm-t-label" style={{ display: info ? "inline" : "block", marginBottom: info ? 0 : 5 }}>
      {label}
      {required && <span aria-hidden="true"> *</span>}
    </span>
  );

  let body: React.ReactNode;
  if (htmlFor) {
    body = info ? (
      <div className="bpm-label-row" style={{ marginBottom: 5 }}>
        <label htmlFor={htmlFor}>{text}</label>
        <InfoTip label={label}>{info}</InfoTip>
      </div>
    ) : <label htmlFor={htmlFor} style={{ display: "block" }}>{text}</label>;
    body = <>{body}{children}</>;
  } else if (info && isValidElement<{ id?: string }>(children)) {
    // The "i" is a button, so it cannot sit inside the label that wraps the control: label the control by id instead.
    const id = children.props.id ?? `fld-${autoId}`;
    body = (
      <>
        <div className="bpm-label-row" style={{ marginBottom: 5 }}>
          <label htmlFor={id}>{text}</label>
          <InfoTip label={label}>{info}</InfoTip>
        </div>
        {children.props.id ? children : cloneElement(children, { id })}
      </>
    );
  } else {
    body = (
      <label style={{ display: "block" }}>
        {info ? <span className="bpm-label-row" style={{ marginBottom: 5 }}>{text}<InfoTip label={label}>{info}</InfoTip></span> : text}
        {children}
      </label>
    );
  }

  return (
    <div data-guide={guide} style={{ marginBottom: 16, ...style }}>
      {body}
      {error ? (
        <div role="alert" className="bpm-t-help" style={{ marginTop: 5, color: "var(--err-ink)" }}>{error}</div>
      ) : hint ? (
        <div className="bpm-t-help" style={{ marginTop: 5 }}>{hint}</div>
      ) : null}
    </div>
  );
}
