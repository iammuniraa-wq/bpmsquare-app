"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { countRatings } from "@/lib/studio/ratings";
import {
  AREA_IDS, AREA_META, CONFIDENCE_LABEL, RATING_LABEL, type FitRow, type Rating, type StepRow,
} from "@/lib/studio/types";
import { useStepRunner, type StepProps } from "./studioClient";
import { Head, OptionGroup, Opt, RatingPill, Switch, Tuck, cx } from "./ui";
import styles from "./studio.module.css";

const TILES: Rating[] = ["standard", "needs_setup", "partly", "not_covered"];

export default function FitStep({ bundle, canEdit, toast, openCap, caps }: StepProps) {
  const { study, steps, fit } = bundle;
  const [show, setShow] = useState<Record<Rating, boolean>>({ standard: true, needs_setup: true, partly: true, not_covered: true, needs_review: true, coming: true });
  const [ids, setIds] = useState(false);
  const { run, busy } = useStepRunner(study.id, toast);

  const counts = countRatings(fit);
  const byStep = new Map<string, FitRow>(fit.map((f) => [f.step_id, f]));
  const reviewed = !!study.reviewed_at;
  const toCheck = counts.needs_review + counts.coming;
  const areas = AREA_IDS.filter((a) => steps.some((s) => s.area === a));

  const confText = (f: FitRow): string => (f.reviewed ? "Reviewed by BPMSquare" : CONFIDENCE_LABEL[f.confidence]);

  const row = (s: StepRow) => {
    const f = byStep.get(s.id);
    if (!f) return null;
    const names = f.capability_ids.map((id) => caps[id]?.label ?? id);
    return (
      <details key={s.id} className={styles.frow}>
        <summary>
          <RatingPill rating={f.rating} />
          <div className={styles.sn}>
            <b>{s.name}</b>
            <span>{names.length ? `Covered by ${names.join(", ")}` : f.rating === "needs_review" ? "A person at BPMSquare will check this one" : "Not in BPMSquare today"}</span>
          </div>
          <span className={cx(styles.conf, (f.reviewed || reviewed) && styles.ok)}>{reviewed ? "Reviewed by BPMSquare" : confText(f)}</span>
        </summary>
        <div className={styles.frowBody}>
          <p style={{ margin: 0 }}>
            {f.why || (f.rating === "needs_review" ? "We could not back this with something that exists in BPMSquare, so we have not rated it. We will check it with you." : "")}
          </p>
          {f.capability_ids.length > 0 && (
            <div className={styles.cov}>
              <span className={styles.help}>Where:</span>
              {f.capability_ids.map((id) => <button key={id} type="button" className={styles.cap} onClick={() => openCap(id)}>{caps[id]?.label ?? id}</button>)}
            </div>
          )}
          <div className={styles.cov}><span className={styles.help}>How you do it today:</span><span className={styles.help}>{s.how_today || "not said"}</span></div>
          {ids && f.capability_ids.length > 0 && (
            <div className={styles.cov}>{f.capability_ids.map((id) => <button key={id} type="button" className={cx(styles.cap, styles.mono)} onClick={() => openCap(id)}>{id}</button>)}</div>
          )}
        </div>
      </details>
    );
  };

  return (
    <>
      <aside className={styles.panel} aria-label="Options">
        <OptionGroup id="p3filter" title="Show" hint="Pick which lines to see. All are on by default." defaultOpen>
          <div style={{ display: "grid", gap: 6 }}>
            {(Object.keys(show) as Rating[]).filter((r) => TILES.includes(r) || counts[r] > 0).map((r) => (
              <label key={r} className={styles.chk}>
                <input type="checkbox" checked={show[r]} onChange={(e) => setShow((cur) => ({ ...cur, [r]: e.target.checked }))} />
                <RatingPill rating={r} />
              </label>
            ))}
          </div>
        </OptionGroup>

        <OptionGroup title="More" hint="Technical ids for your IT team, and re-checking after edits.">
          <Switch label="Show catalogue ids" checked={ids} onChange={setIds} hint="The technical id behind each named module or screen. Off for most people; on for your IT team." />
          {canEdit && (
            <Opt label="Re-check the fit" hint="After you change the map. The old result is kept as a version.">
              <Button style={{ width: "100%" }} loading={busy === "fit"} onClick={() => void run("fit")}>Check again</Button>
            </Opt>
          )}
        </OptionGroup>

        <Tuck title="What the ratings mean">
          <p><RatingPill rating="standard" /> Works out of the box; you only load your data.</p>
          <p><RatingPill rating="needs_setup" /> Standard, once an admin sets it up in Settings.</p>
          <p><RatingPill rating="partly" /> Most is there; a piece needs a change we list in the next step.</p>
          <p><RatingPill rating="not_covered" /> Not in BPMSquare today. We say what we would build, or what to keep elsewhere.</p>
          <p className={styles.help}>A rating is only given with a named module, screen or setting behind it. If we are not sure, the line says &ldquo;check with us&rdquo; instead of guessing.</p>
        </Tuck>
      </aside>

      <div className={styles.work}>
        <Head title="How BPMSquare fits" sub="One line per step. Open a line for the why, and tap any name to see exactly what it is." />
        <div id="reviewBanner" className={cx(styles.banner, reviewed ? styles.good : styles.warnb)} role="status">
          {reviewed
            ? "Reviewed by BPMSquare: every line has been checked by a person."
            : "Draft: BPMSquare reviews this before it becomes a proposal."}
          {toCheck > 0 && !reviewed ? ` ${toCheck} line${toCheck === 1 ? "" : "s"} could not be rated yet and will be checked with you.` : ""}
        </div>
        {fit.length === 0 ? (
          <p className={styles.empty}>Nothing to show yet. Press Check the fit.</p>
        ) : (
          <>
            <div id="tiles" className={styles.tiles}>
              {TILES.map((r) => <div key={r} className={cx(styles.tile, styles[r])}><b>{counts[r]}</b><span>{RATING_LABEL[r]}</span></div>)}
            </div>
            <div id="fit" className={styles.fitrows}>
              {areas.map((a) => {
                const mine = steps.filter((s) => s.area === a && byStep.has(s.id) && show[byStep.get(s.id)!.rating]);
                if (mine.length === 0) return null;
                return (
                  <div key={a} style={{ display: "grid", gap: 8 }}>
                    <div className={styles.areahd}>{AREA_META[a].label}</div>
                    {mine.map(row)}
                  </div>
                );
              })}
            </div>
            {study.noticed.length > 0 && (
              <Tuck title="Things we noticed" note="across the whole process">
                {study.noticed.map((n) => <p key={n} style={{ margin: 0 }}>&bull; {n}</p>)}
              </Tuck>
            )}
          </>
        )}
      </div>
    </>
  );
}
