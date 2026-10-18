"use client";

/**
 * A section for the internal team, closed by default. A native <details>, so the
 * keyboard (Enter / Space on the summary) and screen readers work as they
 * should; the open state is held by the caller, so a link elsewhere on the page
 * (an old ?tab= URL, "Show in 3D") can open it. Its content is only mounted
 * while it is open, so a closed section costs nothing.
 */
export default function Collapsible({
  id, title, hint, open, onToggle, children,
}: {
  id: string;
  title: string;
  hint?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <details id={id} className="est-fold" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </summary>
      {open && <div className="est-fold-body">{children}</div>}
    </details>
  );
}
