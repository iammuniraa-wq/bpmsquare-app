"use client";

import { useTenant } from "@/lib/tenant-context";
import Button from "@/components/ui/Button";
import { askDockToAnalyse, canAnalyse } from "@/lib/analysis/dockAsk";

/**
 * "Analyse" for one company, in the one place a screen keeps its record actions. It opens the AI slider with a prepared
 * question; the slider reads the saved analysis first (free) and asks before it searches the web. Self-gating, like
 * Account360Button: a workspace without the assistant and web research renders nothing, so a server page mounts it
 * unconditionally. `show` lets a server page add its own permission check.
 */
export default function AnalyseButton({ name, accountId, label = "Analyse company", show = true, className }: {
  name: string;
  accountId: string | null;
  label?: string;
  show?: boolean;
  /** For a screen with its own button style (the Buying signals workspace). Without it the shared Button is used. */
  className?: string;
}) {
  const tenant = useTenant();
  if (!show || !canAnalyse(tenant?.features)) return null;
  const onClick = () => askDockToAnalyse(name, accountId);
  if (className) {
    return <button type="button" className={className} onClick={onClick}>{label}</button>;
  }
  return <Button variant="secondary" icon={<Glyph />} onClick={onClick}>{label}</Button>;
}

function Glyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
