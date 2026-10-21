"use client";

import s from "./middleware.module.css";
import { slimLine, type SetupStatus, type SetupTarget } from "./setup";
import { MIDDLEWARE_TIPS } from "./tips";
import InfoTip from "@/components/ui/InfoTip";

/**
 * One slim line: "Set up 3 of 5 · Next: send a test quote". The line opens where the next step is done.
 * Hidden once all five are done; the connection state is shown once, on the connector chip.
 */
export default function SetupGuide({ status, loading, onOpen }: { status: SetupStatus; loading: boolean; onOpen: (target: SetupTarget) => void }) {
  if (status.complete || loading || !status.next) return null;
  const next = status.next;
  return (
    <div className={s.slimLine}>
      <button type="button" className={s.slimBtn} onClick={() => onOpen(next.target)}>{slimLine(status)}</button>
      <InfoTip label="Set up">{MIDDLEWARE_TIPS.setup}</InfoTip>
    </div>
  );
}
