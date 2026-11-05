import type { LogoKey } from "@/lib/crew/registry";
import s from "./crew.module.css";

// One distinctive SVG mark per agent (docs/design/nova-crew-agents.md, owner request 2026-11-04). SVG only, no emoji, no external image. Every
// colour is a CSS custom property set by the tile's accent class (crew.module.css), and those properties come from the same pillar tokens the
// themes already remap, so a mark reads in light and in dark mode. Pure shapes, no animation of their own: the tile animates its status dot only,
// and prefers-reduced-motion switches that off. Adding an agent = one more component here + one entry in src/lib/crew/registry.ts.

type P = { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 64 64", "aria-hidden": true, focusable: false as const });

export function TenderWatchLogo({ size = 64 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="10" y="7" width="35" height="46" rx="6" className={s.lgSoft} />
      <path d="M10 13a6 6 0 0 1 6-6h23a6 6 0 0 1 6 6v6H10z" className={s.lgA} />
      <circle cx="17" cy="13" r="2" className={s.lgPanel} />
      <circle cx="24" cy="13" r="2" className={s.lgPanel} />
      <rect x="17" y="26" width="22" height="3" rx="1.5" className={s.lgInkSoft} />
      <rect x="17" y="33" width="17" height="3" rx="1.5" className={s.lgInkSoft} />
      <rect x="17" y="40" width="11" height="3" rx="1.5" className={s.lgInkSoft} />
      <path d="M31 45c4-7 10-10 16-10s12 3 16 10c-4 7-10 10-16 10s-12-3-16-10z" className={s.lgPanel} strokeWidth="2.4" />
      <circle cx="47" cy="45" r="7.5" className={s.lgA} />
      <circle cx="47" cy="45" r="3.4" className={s.lgInk} />
      <circle cx="49.4" cy="42.6" r="1.4" className={s.lgPanel} stroke="none" />
      <path d="M50 9a10 10 0 0 1 8 8M50 3a16 16 0 0 1 13 13" className={s.lgStrokeA} fill="none" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function AttendanceLogo({ size = 64 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="29" cy="28" r="21" className={s.lgSoft} />
      <circle cx="29" cy="28" r="21" fill="none" className={s.lgStrokeInk} strokeWidth="2.4" />
      <path d="M29 12v4M29 40v4M13 28h4M41 28h4" className={s.lgStrokeInk} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M29 28V18M29 28l8 5" className={s.lgStrokeInk} strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="29" cy="28" r="3.4" className={s.lgA} />
      <path d="M8 56h48" className={s.lgStrokeSoft} strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="14" cy="56" r="3.2" className={s.lgA} />
      <circle cx="26" cy="56" r="3.2" className={s.lgA} />
      <circle cx="38" cy="56" r="3.2" className={s.lgA} />
      <circle cx="52" cy="48" r="9" className={s.lgAlertHalo} />
      <circle cx="52" cy="48" r="4.6" className={s.lgAlert} />
      <path d="M52 44.6v3.6" className={s.lgStrokePanel} strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="52" cy="50.6" r=".9" className={s.lgPanel} stroke="none" />
    </svg>
  );
}

export function QuoteFollowUpLogo({ size = 64 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M10 14a6 6 0 0 1 6-6h32a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H29l-11 10v-10h-2a6 6 0 0 1-6-6z" className={s.lgSoft} />
      <path d="M10 14a6 6 0 0 1 6-6h32a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H29l-11 10v-10h-2a6 6 0 0 1-6-6z" fill="none" className={s.lgStrokeInk} strokeWidth="2.4" />
      <path d="M22 28a10 10 0 1 1 4 7.6" fill="none" className={s.lgStrokeA} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M17 29l5-6 5 6z" className={s.lgA} />
    </svg>
  );
}

export function InvoiceChaserLogo({ size = 64 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M12 6h32v48l-5.3-4-5.4 4-5.3-4-5.4 4-5.3-4-5.3 4z" className={s.lgSoft} />
      <path d="M12 6h32v48l-5.3-4-5.4 4-5.3-4-5.4 4-5.3-4-5.3 4z" fill="none" className={s.lgStrokeInk} strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="19" y="14" width="18" height="3" rx="1.5" className={s.lgInkSoft} />
      <rect x="19" y="21" width="12" height="3" rx="1.5" className={s.lgInkSoft} />
      <circle cx="46" cy="38" r="13" className={s.lgA} />
      <path d="M46 31v14M41.5 35.5c0-2.2 2-3.5 4.5-3.5s4.5 1.2 4.5 3.2c0 4-9 2.6-9 6.6 0 2 2 3.2 4.5 3.2s4.5-1.3 4.5-3.5" fill="none" className={s.lgStrokePanel} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M4 44h7M2 50h9" className={s.lgStrokeA} strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function LeadNurtureLogo({ size = 64 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M32 58V30" className={s.lgStrokeInk} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M32 36C32 24 22 16 10 18c-1 12 7 21 22 18z" className={s.lgA} />
      <path d="M32 30c0-10 8-17 20-16 1 11-6 19-20 16z" className={s.lgSoft} />
      <path d="M32 30c0-10 8-17 20-16 1 11-6 19-20 16z" fill="none" className={s.lgStrokeInk} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M22 58h20" className={s.lgStrokeSoft} strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M52 4l1.8 4.6L58 10l-4.2 1.4L52 16l-1.8-4.6L46 10l4.2-1.4z" className={s.lgAlert} />
    </svg>
  );
}

export function ContractRenewalLogo({ size = 64 }: P) {
  return (
    <svg {...base(size)}>
      <rect x="10" y="6" width="34" height="46" rx="6" className={s.lgSoft} />
      <rect x="10" y="6" width="34" height="46" rx="6" fill="none" className={s.lgStrokeInk} strokeWidth="2.4" />
      <rect x="17" y="15" width="20" height="3" rx="1.5" className={s.lgInkSoft} />
      <rect x="17" y="22" width="14" height="3" rx="1.5" className={s.lgInkSoft} />
      <path d="M17 44c4-3 6 2 10-1" fill="none" className={s.lgStrokeInk} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="46" cy="42" r="14" className={s.lgA} />
      <path d="M38.5 41a8 8 0 0 1 13.4-4.6M53.5 43a8 8 0 0 1-13.4 4.6" fill="none" className={s.lgStrokePanel} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M52.6 31.8l.6 5.6-5.6-.6zM39.4 52.2l-.6-5.6 5.6.6z" className={s.lgPanel} stroke="none" />
    </svg>
  );
}

export const LOGOS: Record<LogoKey, (p: P) => React.JSX.Element> = {
  tender_watch: TenderWatchLogo,
  attendance: AttendanceLogo,
  quote_follow_up: QuoteFollowUpLogo,
  invoice_chaser: InvoiceChaserLogo,
  lead_nurture: LeadNurtureLogo,
  contract_renewal: ContractRenewalLogo,
};
