"use client";

import "@/styles/rich-accounts.css";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import StatusPill from "@/components/ui/StatusPill";
import PhotoFrame from "@/components/ui/PhotoFrame";
import Account360Button from "@/components/Account360Button";
import { Phone, Mail, FileText } from "@/components/Icons";
import {
  ACCOUNTS_VIEWS, ACCOUNTS_VIEW_KEY, parseAccountsView,
  type AccountsView, type RichAccountRow, type TypeChip,
} from "@/lib/richAccounts";

const VIEW_LABEL: Record<AccountsView, string> = { rows: "Rows", cards: "Cards", table: "Table" };

function ViewIcon({ view }: { view: AccountsView }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (view === "rows") return <svg {...p}><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /></svg>;
  if (view === "cards") return <svg {...p}><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></svg>;
  return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg>;
}

/** Call, e-mail and new quote. Each is drawn only when the record (or the caller's grant) already supports it. */
function QuickActions({ row }: { row: RichAccountRow }) {
  return (
    <div className="rich-acts">
      {row.tel && <a className="rich-act rich-act--call" href={row.tel} aria-label={`Call ${row.name}`} data-guide="accounts.row.call"><Phone size={18} /></a>}
      {row.mail && <a className="rich-act" href={row.mail} aria-label={`E-mail ${row.name}`} data-guide="accounts.row.email"><Mail size={18} /></a>}
      {row.quoteHref && <Link className="rich-act" href={row.quoteHref} aria-label={`New quote for ${row.name}`} data-guide="accounts.row.quote"><FileText size={18} /></Link>}
      <span className="rich-act rich-act--360"><Account360Button accountId={row.id} variant="link" /></span>
    </div>
  );
}

function Tile({ row }: { row: RichAccountRow }) {
  return <div className={`rich-tile rich-photo rich-photo--${row.mesh}`} aria-hidden="true">{row.initials}</div>;
}

function Meta({ row }: { row: RichAccountRow }) {
  return (
    <div className="rich-meta">
      <StatusPill label={row.typeLabel} tone={row.typeTone} />
      {row.chips.map((ch) => <span key={ch.key} className="rich-chip">{ch.label}</span>)}
    </div>
  );
}

/**
 * The Rich Accounts list (docs/design/rich-ui.md): Rows (default), Cards or the existing Table. Rendered by the accounts page only
 * when isRichTenant() is true. It draws what the page already filtered, sorted and paged; searching, the advanced filter, sorting,
 * column search and the pager keep working exactly as before (the Table view IS the standard table, `table`).
 */
export default function RichAccountsView({ rows, typeChips, table, pager, total, filtered }: {
  rows: RichAccountRow[];
  typeChips: TypeChip[];
  /** The standard list body (table, phone card stack, pager) from ObjectListPage: the Table view. */
  table: React.ReactNode;
  /** The server pager for Rows and Cards (the Table view carries its own). */
  pager: React.ReactNode;
  total: number;
  filtered: boolean;
}) {
  const [view, setView] = useState<AccountsView>("rows");
  const group = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setView(parseAccountsView(window.localStorage.getItem(ACCOUNTS_VIEW_KEY))); } catch { /* storage blocked: stay on Rows */ }
  }, []);

  const choose = (v: AccountsView) => {
    setView(v);
    try { window.localStorage.setItem(ACCOUNTS_VIEW_KEY, v); } catch { /* not remembered, still works */ }
  };

  const onKey = (e: React.KeyboardEvent) => {
    const i = ACCOUNTS_VIEWS.indexOf(view);
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % 3 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i + 2) % 3 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(ACCOUNTS_VIEWS[next]);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div className="rich-acc" data-view={view}>
      <div className="rich-acc__bar">
        <nav className="rich-acc__chips" aria-label="Filter by account type">
          {typeChips.map((ch) => (
            <Link key={ch.id} href={ch.href} className="rich-pillink" aria-current={ch.active ? "true" : undefined} data-guide={`accounts.type.${ch.id}`}>{ch.label}</Link>
          ))}
        </nav>
        <div className="rich-acc__switch" role="radiogroup" aria-label="View" ref={group} onKeyDown={onKey} data-guide="accounts.view">
          {ACCOUNTS_VIEWS.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} tabIndex={view === v ? 0 : -1} onClick={() => choose(v)}>
              <ViewIcon view={v} /><span>{VIEW_LABEL[v]}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered && <p className="rich-acc__count" aria-live="polite">{`${total} ${total === 1 ? "match" : "matches"}`}</p>}

      {view === "table" && <div className="rich-acc__table">{table}</div>}

      {view === "rows" && (
        <>
          <ul className="rich-rows" role="list">
            {rows.map((row, i) => (
              <li key={row.id} className="rich-row" style={{ ["--i" as string]: Math.min(i, 12) }}>
                <Tile row={row} />
                <div className="rich-row__main">
                  <h3 className="rich-name"><Link className="rich-open" href={row.href}>{row.name}</Link></h3>
                  {row.line && <p className="rich-line">{row.line}</p>}
                </div>
                <Meta row={row} />
                <QuickActions row={row} />
              </li>
            ))}
          </ul>
          {pager}
        </>
      )}

      {view === "cards" && (
        <>
          <ul className="rich-cards" role="list">
            {rows.map((row, i) => (
              <li key={row.id} className="rich-card" style={{ ["--i" as string]: Math.min(i, 12) }}>
                <PhotoFrame mesh={row.mesh} height={104} style={{ borderRadius: 0 }} />
                <Tile row={row} />
                <div className="rich-card__body">
                  <h3 className="rich-name"><Link className="rich-open" href={row.href}>{row.name}</Link></h3>
                  {row.line && <p className="rich-line">{row.line}</p>}
                  <Meta row={row} />
                  <QuickActions row={row} />
                </div>
              </li>
            ))}
          </ul>
          {pager}
        </>
      )}
    </div>
  );
}
