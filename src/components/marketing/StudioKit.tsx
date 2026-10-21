"use client";

import styles from "@/app/(app)/marketing/journeys/journey.module.css";

// The collapsible option group every studio-type screen of the small marketing modules shares (platform rule,
// docs/marketing-platform-architecture.md section 6.0). It uses the Journey builder's stylesheet so the
// studios look alike; colours come only from the theme variables in globals.css. The "Show me how" walkthrough is Tour.tsx.

export { styles as studio };
export const cx = (...p: (string | false | null | undefined)[]): string => p.filter(Boolean).join(" ");

const Chevron = () => (
  <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function Group({ id, title, summary, hint, open, onToggle, children }: {
  id: string; title: string; summary: string; hint: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section className={cx(styles.sec, open && styles.open)} id={id}>
      <button type="button" className={styles.sech} aria-expanded={open} aria-controls={`${id}Body`} onClick={onToggle}>
        <b>{title}</b><span className={styles.sum}>{summary}</span><span className={styles.hint}>{hint}</span><Chevron />
      </button>
      <div className={styles.in} id={`${id}Body`} hidden={!open}>{children}</div>
    </section>
  );
}
