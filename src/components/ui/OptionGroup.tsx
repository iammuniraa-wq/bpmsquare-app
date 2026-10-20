"use client";

import InfoTip from "./InfoTip";

/**
 * One collapsible group in a studio's left panel. The header is a ROW, not one button, so the "i" can sit beside
 * the title without becoming a button inside a button (the HTML parser splits that, and the header falls apart):
 * the title button stretches over the whole row with a ::after overlay and the "i" floats above it.
 *
 * `open` is whether the body shows (desktop: one open at a time). `on` marks the group the phone's tab strip has
 * selected: under 900 px only the `on` group renders, as a slim, non-clickable title row (title, summary, "i") above
 * its options, so its explanation stays reachable even though tabs never carry an "i". The panel that holds the
 * groups carries the `bpm-og-panel` class, which the responsive rules key on.
 */
export default function OptionGroup({ id, title, summary, info, open, on, onToggle, children }: {
  id: string;
  title: string;
  summary?: string;
  info?: React.ReactNode;
  open: boolean;
  on?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`bpm-og${open ? " open" : ""}${on ? " on" : ""}`} id={id}>
      <div className="bpm-og-head">
        <button type="button" className="bpm-og-title" aria-expanded={open} aria-controls={`${id}Body`} onClick={onToggle}>{title}</button>
        {info ? <InfoTip label={title}>{info}</InfoTip> : <span />}
        {summary ? <span className="bpm-og-sum">{summary}</span> : <span />}
        <svg className="bpm-og-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div className="bpm-og-body" id={`${id}Body`} hidden={!open}>{children}</div>
    </section>
  );
}
