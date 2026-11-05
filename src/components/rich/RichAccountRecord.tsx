import Link from "next/link";
import "@/styles/rich-account-record.css";
import TabTitle from "@/components/TabTitle";
import Tabs from "@/components/ui/Tabs";
import InfoTip from "@/components/ui/InfoTip";
import Ring from "@/components/ui/Ring";
import PhotoFrame from "@/components/ui/PhotoFrame";
import StatusPill from "@/components/ui/StatusPill";
import { RecordEditProvider } from "@/components/page/RecordEditContext";
import { Activity, Briefcase, FileText, Gear, LifeBuoy, Mail, Package, Phone, Receipt, Shield, Sparkles, Users, CheckIcon } from "@/components/Icons";
import type { CurrencyDef } from "@/lib/currency";
import type { PillarKey } from "@/lib/theme";
import {
  initialsOf, meshFor, ringToneFor, weakestFactor,
  type RichNextStep, type RichSummary, type RichTouch, type RichTouchKind,
} from "@/lib/rich/accountRecord";
import RichCount from "./RichCount";
import RichScrollSelected from "./RichScrollSelected";

export type RichActionKind = "call" | "mail" | "quotation" | "case" | "contact" | "asset" | "invoice" | "project";
/** A link-style quick action: the hero shows them as round buttons, the phone shows them in the sticky bar. */
export type RichAction = { key: string; label: string; href: string; kind: RichActionKind };

export type RichRecordTab = { id: string; label: string; count?: number; content: React.ReactNode };

const ACTION_ICON: Record<RichActionKind, (p: { size: number }) => React.ReactElement> = {
  call: (p) => <Phone {...p} />,
  mail: (p) => <Mail {...p} />,
  quotation: (p) => <Package {...p} />,
  case: (p) => <Activity {...p} />,
  contact: (p) => <Users {...p} />,
  asset: (p) => <Gear {...p} />,
  invoice: (p) => <FileText {...p} />,
  project: (p) => <Gear {...p} />,
};

const TOUCH_ICON: Record<RichTouchKind, (p: { size: number }) => React.ReactElement> = {
  quote: (p) => <FileText {...p} />,
  case: (p) => <LifeBuoy {...p} />,
  invoice: (p) => <Receipt {...p} />,
  contract: (p) => <Shield {...p} />,
  account: (p) => <Briefcase {...p} />,
};

const URGENCY_TONE: Record<RichNextStep["urgency"], PillarKey> = { high: "red", medium: "amber", low: "blue" };
const URGENCY_LABEL: Record<RichNextStep["urgency"], string> = { high: "Do first", medium: "Soon", low: "When free" };

/** tel: and mailto: are plain anchors; the app's own pages go through Link so the move is instant. */
function ActionLink({ href, children, ...rest }: { href: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return href.startsWith("/") ? <Link href={href} {...rest}>{children}</Link> : <a href={href} {...rest}>{children}</a>;
}

// ── Hero ─────────────────────────────────────────────────────────────────────

export function RichHero({ name, reference, city, status, actions, primaryAction, menu, externalLine }: {
  name: string;
  reference?: string | null;
  city?: string | null;
  status: React.ReactNode;
  actions: RichAction[];
  primaryAction?: React.ReactNode;
  menu?: React.ReactNode;
  externalLine?: React.ReactNode;
}) {
  const line = [reference, city].filter(Boolean).join(" · ");
  return (
    <header className="rich-acct__hero-wrap">
      <PhotoFrame mesh={meshFor(name)} radius={32} height="auto" style={{ minHeight: 0 }}>
        <div className="rich-acct__hero">
          <div className="rich-acct__id">
            <span className="rich-acct__tile" aria-hidden="true">{initialsOf(name)}</span>
            <div className="rich-acct__who">
              <h1 className="rich-acct__name">{name}</h1>
              <div className="rich-acct__sub">
                {line ? <span>{line}</span> : null}
                {status}
              </div>
            </div>
          </div>
          <div className="rich-acct__acts">
            {actions.length > 0 && (
              <div className="rich-acct__quick" role="group" aria-label="Quick actions">
                {actions.map((a) => {
                  const Icon = ACTION_ICON[a.kind];
                  const spoken = a.kind === "call" || a.kind === "mail" ? a.label : `New ${a.label.toLowerCase()}`;
                  return (
                    <ActionLink key={a.key} className="rich-acct__round" href={a.href} title={spoken} aria-label={spoken}>
                      <Icon size={20} />
                    </ActionLink>
                  );
                })}
              </div>
            )}
            {primaryAction ? <div className="rich-acct__primary" data-guide="record.primary">{primaryAction}</div> : null}
            {menu ? <div className="rich-acct__menu">{menu}</div> : null}
          </div>
        </div>
      </PhotoFrame>
      {externalLine ? <div className="rich-acct__ext">{externalLine}</div> : null}
    </header>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function RichSummaryRow({ summary, cur, tabHref, hasTab }: {
  summary: RichSummary;
  cur: CurrencyDef;
  tabHref: (id: string) => string;
  /** Whether the tab a card links to is on screen for this tenant. */
  hasTab: (id: string) => boolean;
}) {
  const { health, pipeline, openCases, outstanding, lastTouch } = summary;
  const weak = weakestFactor(health);
  const wrap = (id: string | null, children: React.ReactNode, key: string, href?: string) => {
    const to = href ?? (id && hasTab(id) ? tabHref(id) : null);
    return (
      <li key={key} className="rich-acct__card">
        {to ? <Link className="rich-acct__cardlink" href={to} scroll={false}>{children}</Link> : <div className="rich-acct__cardlink">{children}</div>}
      </li>
    );
  };

  return (
    <ul className="rich-acct__sum" aria-label="Account at a glance">
      <li className="rich-acct__card rich-acct__card--health">
        <div className="rich-acct__cardlink">
          <Ring value={health.score} size={112} stroke={11} tone={ringToneFor(health.grade)} label="Account health">{health.score}</Ring>
          <div className="rich-acct__cardtext">
            <span className="rich-acct__label">Health <InfoTip label="Health">Scored from recency, win rate, payment, service and contacts. The weakest signal is named below it.</InfoTip></span>
            <span className="rich-acct__value rich-acct__value--sm">{health.label}</span>
            {weak ? <span className="rich-acct__note">{weak.detail}</span> : null}
          </div>
        </div>
      </li>
      {pipeline && wrap("quotations", (
        <div className="rich-acct__cardtext">
          <span className="rich-acct__label">Pipeline <InfoTip label="Pipeline">The total of quotations that are still open.</InfoTip></span>
          <span className="rich-acct__value"><RichCount value={pipeline.value} cur={cur} /></span>
          <span className="rich-acct__note">{`${pipeline.openCount} open`}</span>
        </div>
      ), "pipeline")}
      {openCases && wrap("cases", (
        <div className="rich-acct__cardtext">
          <span className="rich-acct__label">Open cases</span>
          <span className="rich-acct__value"><RichCount value={openCases.open} /></span>
          <span className="rich-acct__note">{openCases.aged > 0 ? `${openCases.aged} over 30 days` : "None aging"}</span>
        </div>
      ), "cases")}
      {outstanding && wrap("invoices", (
        <div className="rich-acct__cardtext">
          <span className="rich-acct__label">Owed <InfoTip label="Owed">Issued invoices not yet paid in full, less drafts and cancelled ones.</InfoTip></span>
          <span className={`rich-acct__value${outstanding.overdueCount > 0 ? " is-warm" : ""}`}><RichCount value={outstanding.amount} cur={cur} /></span>
          <span className="rich-acct__note">{outstanding.overdueCount > 0 ? `${outstanding.overdueCount} overdue` : "None overdue"}</span>
        </div>
      ), "owed")}
      {lastTouch && wrap(null, (
        <div className="rich-acct__cardtext">
          <span className="rich-acct__label">Last touch</span>
          <span className="rich-acct__value rich-acct__value--sm">{lastTouch.when}</span>
          <span className="rich-acct__note">{lastTouch.title}</span>
        </div>
      ), "touch", lastTouch.href)}
    </ul>
  );
}

// ── Next best step ───────────────────────────────────────────────────────────

export function RichNextStepCard({ step }: { step: RichNextStep | null }) {
  return (
    <section className="rich-acct__next" aria-label="Next best step" data-urgency={step?.urgency ?? "none"}>
      <span className="rich-acct__gem" aria-hidden="true">{step ? <Sparkles size={22} /> : <CheckIcon size={22} />}</span>
      <div className="rich-acct__nexttext">
        <span className="rich-acct__label">
          Next best step
          <InfoTip label="Next best step">Picked by fixed rules from this account&apos;s records, not by AI. The same records always give the same step.</InfoTip>
        </span>
        {step ? (
          <>
            <strong className="rich-acct__steptitle">{step.title}</strong>
            <span className="rich-acct__note">{step.detail}</span>
            {step.more > 0 ? <span className="rich-acct__note">{`${step.more} more in Account 360`}</span> : null}
          </>
        ) : (
          <strong className="rich-acct__steptitle">All clear</strong>
        )}
      </div>
      {step ? (
        <div className="rich-acct__nextacts">
          <StatusPill label={URGENCY_LABEL[step.urgency]} tone={URGENCY_TONE[step.urgency]} />
          {step.href ? <Link className="rich-acct__go" href={step.href}>Open</Link> : null}
        </div>
      ) : null}
    </section>
  );
}

// ── Touch timeline ───────────────────────────────────────────────────────────

export function RichTouchTimeline({ touches }: { touches: RichTouch[] }) {
  if (touches.length === 0) return null;
  return (
    <section className="rich-acct__tl" aria-label="Latest touches">
      <h2 className="rich-acct__h2">Latest touches</h2>
      <ol className="rich-acct__tlist">
        {touches.map((t, i) => {
          const Icon = TOUCH_ICON[t.kind];
          return (
            <li key={t.id} className="rich-acct__tli" data-first={i === 0 ? "true" : undefined} data-tone={t.tone}>
              <Link href={t.href} className="rich-acct__tlink">
                <span className="rich-acct__dot" aria-hidden="true"><Icon size={20} /></span>
                <span className="rich-acct__tltext">
                  <b>{t.title}</b>
                  <small>{t.detail ? `${t.when} · ${t.detail}` : t.when}</small>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Phone quick bar ──────────────────────────────────────────────────────────

export function RichQuickBar({ actions }: { actions: RichAction[] }) {
  const shown = actions.slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <nav className="rich-acct__bar" aria-label="Quick actions">
      {shown.map((a) => {
        const Icon = ACTION_ICON[a.kind];
        return (
          <ActionLink key={a.key} className="rich-acct__barbtn" href={a.href}>
            <Icon size={22} />
            <span>{a.label}</span>
          </ActionLink>
        );
      })}
    </nav>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

/**
 * The Rich account record (docs/design/rich-ui.md, "Account record"): hero, an at-a-glance row, tabs, and on Overview the next best
 * step, the latest touches and the detail sections. Every tab, section and action of the standard page is passed in by the page and
 * stays reachable; this component only arranges them. Server component; the one client piece with state is RichSection.
 */
export default function RichAccountRecord({
  backHref, backLabel, name, reference, city, status, summary, cur, nextStep, touches, actions, primaryAction, menu, externalLine,
  tabs, activeTab, basePath, overviewDetail,
}: {
  backHref: string;
  backLabel: string;
  name: string;
  reference?: string | null;
  city?: string | null;
  status: React.ReactNode;
  summary: RichSummary;
  cur: CurrencyDef;
  nextStep: RichNextStep | null;
  touches: RichTouch[];
  actions: RichAction[];
  primaryAction?: React.ReactNode;
  menu?: React.ReactNode;
  externalLine?: React.ReactNode;
  /** The first tab must be Overview; its `content` is ignored in favour of the lead cards plus `overviewDetail`. */
  tabs: RichRecordTab[];
  activeTab?: string;
  basePath: string;
  overviewDetail: React.ReactNode;
}) {
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const tabHref = (id: string) => `${basePath}?tab=${id}`;
  const onOverview = active.id === tabs[0].id;

  return (
    <RecordEditProvider>
      <TabTitle title={name} />
      <div className="rich-acct">
        <Link href={backHref} className="bpm-backlink rich-acct__back" data-guide="record.back">← {backLabel}</Link>

        <RichHero name={name} reference={reference} city={city} status={status} actions={actions} primaryAction={primaryAction} menu={menu} externalLine={externalLine} />
        <RichSummaryRow summary={summary} cur={cur} tabHref={tabHref} hasTab={(id) => tabs.some((t) => t.id === id)} />

        {tabs.length > 1 && (
          <RichScrollSelected>
            <Tabs tabs={tabs.map(({ id, label, count }) => ({ id, label, count }))} value={active.id} hrefFor={tabHref} />
          </RichScrollSelected>
        )}

        <div className="rich-acct__body">
          {onOverview ? (
            <>
              <RichNextStepCard step={nextStep} />
              <RichTouchTimeline touches={touches} />
              {overviewDetail}
            </>
          ) : active.content}
        </div>

        <RichQuickBar actions={actions} />
      </div>
    </RecordEditProvider>
  );
}
