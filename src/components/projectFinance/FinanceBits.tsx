import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import { toneForLight, toneTokens } from "@/lib/ui/tone";
import { LIGHT_LABEL, LIGHT_WORD, type Light, type LightLevel, type Num } from "@/lib/projectFinance/types";
import { money, pct } from "@/lib/contractProjects/format";
import { stateNote } from "@/lib/projectFinance/state";
import type { ConnState } from "@/lib/projectFinance/types";
import InfoTip from "@/components/ui/InfoTip";
import s from "./projectFinance.module.css";

// Small server-safe pieces the cost and profitability screens share. No hooks. Colour comes from tone tokens, never a literal, and no state is
// carried by colour alone: every light and every figure says it in words.

export const NOT_CONNECTED = "Not connected";

/** The one next step under a figure that needs the ERP read-back: a link for an admin, plain words for everyone else. */
export function NextStep({ isAdmin, text = "Connect the ERP cost read-back", plain }: { isAdmin: boolean; text?: string; plain?: string }) {
  if (!isAdmin) return <span>{plain ?? `Needs the ${text.replace(/^Connect the /, "")}`}</span>;
  return <Link href={ROUTES.settingsMiddleware} className={s.nextLink}>{text}</Link>;
}

/** The ring of a light: solid for a forecast finding, hollow for "plan below floor", an empty grey ring while there is nothing to measure. */
export function LightDot({ level }: { level: LightLevel }) {
  const tone = toneForLight(level);
  const color = level === "not_connected" ? c.hint : toneTokens(tone).edge;
  const solid = level === "good" || level === "watch" || level === "risk";
  return <span aria-hidden="true" className={`${s.dot} ${solid ? s.dotFull : ""}`} style={{ color }} />;
}

export function LightChip({ light }: { light: Light }) {
  return (
    <span className={s.light} data-guide={`pf.light.${light.id}`} data-level={light.level}>
      <LightDot level={light.level} />
      <b>{LIGHT_LABEL[light.id]}</b>
      <span>{LIGHT_WORD[light.level]}</span>
      {light.why && <InfoTip label={`${LIGHT_LABEL[light.id]} light`}>{light.why}</InfoTip>}
    </span>
  );
}

export type Fmt = "money" | "pct";

/** What a figure says: the number in its currency or percent, "Not connected" while there is none, a real 0 once a pull held nothing. */
export function figureText(value: Num, state: ConnState, fmt: Fmt, currency: string | null | undefined): string {
  if (state === "not_connected" || value === null) return NOT_CONNECTED;
  return fmt === "money" ? money(value, currency) : pct(value);
}

/** The words under a figure: where it was read (as of), what it assumes, or the next step when it is not connected. */
export function FigureSub({ state, asOf, isAdmin, extra }: { state: ConnState; asOf: string | null; isAdmin: boolean; extra?: string | null }) {
  if (state === "not_connected") return <NextStep isAdmin={isAdmin} />;
  const note = stateNote(state, asOf);
  return <>{[note, extra].filter(Boolean).join(" · ")}</>;
}
