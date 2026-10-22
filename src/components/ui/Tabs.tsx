import Link from "next/link";

export type TabDef = { id: string; label: string; count?: number };

type Props = {
  tabs: TabDef[];
  value: string;
  /** State mode: the caller keeps the active id (client components). */
  onChange?: (id: string) => void;
  /** URL mode: each tab is a link, so the active tab survives a refresh and can be shared. */
  hrefFor?: (id: string) => string;
  label?: string;
};

/**
 * Underline tab strip. Scrolls sideways on a phone instead of wrapping.
 * In state mode the arrow keys move the selection (roving tabindex); in URL
 * mode every tab is an ordinary link and stays in the tab order.
 */
export default function Tabs({ tabs, value, onChange, hrefFor, label = "Sections" }: Props) {
  return (
    <div role="tablist" aria-label={label} className="bpm-tabs">
      {tabs.map((t) => {
        const selected = t.id === value;
        const body = (
          <>
            {t.label}
            {typeof t.count === "number" && t.count > 0 && <span className="bpm-tab-count">{t.count}</span>}
          </>
        );
        if (hrefFor) {
          return (
            <Link key={t.id} role="tab" data-guide={`tab:${t.id}`} aria-selected={selected} href={hrefFor(t.id)} scroll={false} replace className="bpm-tab">
              {body}
            </Link>
          );
        }
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-guide={`tab:${t.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="bpm-tab"
            onClick={() => onChange?.(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = tabs.findIndex((x) => x.id === t.id);
              const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
              onChange?.(next.id);
              const strip = e.currentTarget.parentElement;
              requestAnimationFrame(() => {
                strip?.querySelectorAll<HTMLElement>('[role="tab"]')[tabs.indexOf(next)]?.focus();
              });
            }}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
