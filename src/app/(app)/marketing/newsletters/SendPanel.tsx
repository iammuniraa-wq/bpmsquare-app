"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Opt } from "@/components/ui/Opt";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import { ROUTES } from "@/lib/constants";
import { ALL_ACCOUNT_TYPES, parseEmailText } from "@/lib/newsletter/sendAudience";
import { NEWSLETTER_TIPS } from "@/lib/newsletter/tips";
import { languageDef } from "@/lib/newsletter/types";
import type { MarketingTargetGroup, AccountType } from "@/lib/types";
import { checkSend, sendNewsletter, type SendAudience, type SendCheck, type SendResult } from "./studioApi";
import styles from "./newsletter.module.css";

const langName = (code: string) => languageDef(code)?.name ?? code;

/**
 * "Send...": the one panel between a finished newsletter and its recipients. Audience first (a saved one, or
 * everyone), a live "N will receive" from the same decisions the send makes, then Send. The topic and the
 * languages are the newsletter's own and are only shown. The consent gate is not here: it runs per person on
 * the server, whatever this panel offers.
 */
export default function SendPanel({ newsletterId, name, topicLabel, languageNames, waiting, onClose, onSent }: {
  newsletterId: string;
  name: string;
  topicLabel: string;
  languageNames: string[];
  /** Languages that still have lines to check: they are not sent, their people get the fallback. */
  waiting: string[];
  onClose: () => void;
  onSent: () => void;
}) {
  const { confirm } = useFeel();
  const [groups, setGroups] = useState<MarketingTargetGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [more, setMore] = useState(false);
  const [types, setTypes] = useState<Set<string>>(new Set(ALL_ACCOUNT_TYPES));
  const [emails, setEmails] = useState("");
  const [plan, setPlan] = useState<SendCheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<SendResult | null>(null);
  const ticket = useRef(0);

  useEffect(() => {
    fetch("/api/marketing/target-groups").then((r) => r.json()).then((d) => setGroups(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const typed = parseEmailText(emails);
  const audience = (): SendAudience => (groupId
    ? { group_id: groupId, manual_emails: typed }
    : more ? { account_types: [...types], manual_emails: typed } : {});
  const nobody = !groupId && more && types.size === 0 && typed.length === 0;
  const key = JSON.stringify([groupId, more, [...types].sort(), typed]);

  useEffect(() => {
    if (done) return;
    if (nobody) { setPlan(null); setChecking(false); return; }
    const mine = ++ticket.current;
    setChecking(true); setError(null);
    const t = setTimeout(async () => {
      const r = await checkSend(newsletterId, audience());
      if (mine !== ticket.current) return;
      setChecking(false);
      if (r.ok) setPlan(r.data); else { setPlan(null); setError(r.error); }
    }, 350);
    return () => clearTimeout(t);
    // The audience is read through `key`; the other inputs never change while the panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, newsletterId, done]);

  async function send() {
    if (!plan) return;
    if (!(await confirm({ title: "Send this newsletter now?", body: `Emails go out immediately to the ${plan.contactable} ${plan.contactable === 1 ? "person" : "people"} who can be emailed. This cannot be recalled.`, confirmLabel: "Send now" }))) return;
    setSending(true); setError(null);
    const r = await sendNewsletter(newsletterId, audience());
    setSending(false);
    if (!r.ok) { setError(r.error); return; }
    setDone(r.data);
    onSent();
  }

  const toggleType = (t: string) => setTypes((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const leftOut = plan ? plan.total - plan.contactable : 0;

  return (
    <SidePanel
      title={`Send ${name || "newsletter"}`}
      subtitle={`${languageNames.join(" + ")} · ${topicLabel}`}
      label="Send newsletter"
      onClose={onClose}
      footer={done ? (
        <>
          <Button href={ROUTES.marketingCampaign(done.campaign_id)}>See what was sent</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      ) : (
        <Button variant="primary" loading={sending} disabled={sending || checking || !plan || plan.contactable === 0} onClick={() => void send()}>
          {plan && plan.contactable > 0 ? `Send to ${plan.contactable}` : "Send"}
        </Button>
      )}
    >
      {done ? (
        <div className={styles.res} role="status">
          <div className={styles.resBig}>{done.sent} sent</div>
          <div className={styles.help}>{[done.skipped ? `${done.skipped} left out` : "", done.failed ? `${done.failed} failed` : ""].filter(Boolean).join(" · ") || "Everyone in the audience was emailed."}</div>
        </div>
      ) : (
        <>
          <Opt label="Audience" info={NEWSLETTER_TIPS.sendAudience} htmlFor="sendAudience">
            <select id="sendAudience" className={`${styles.select} ${styles.sendCtl}`} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Everyone we can email</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Opt>

          <div>
            <button type="button" className={styles.moreBtn} aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? "Less" : "More"}</button>
          </div>
          {more && (
            <div className={styles.sendMore}>
              <div className="bpm-label-row"><span className={styles.lbl}>One-off</span><InfoTip label="One-off audience">{NEWSLETTER_TIPS.sendMore}</InfoTip></div>
              {!groupId && (
                <div className={styles.chips} role="group" aria-label="Account types">
                  {ALL_ACCOUNT_TYPES.map((t) => (
                    <label key={t} className={styles.chk}><input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} />{ACCOUNT_TYPE_LABEL[t as AccountType]}</label>
                  ))}
                </div>
              )}
              <label className={styles.lbl} htmlFor="sendEmails">Add email addresses</label>
              <textarea id="sendEmails" className={`${styles.field} ${styles.sendCtl}`} value={emails} placeholder="name@company.com, another@company.com" onChange={(e) => setEmails(e.target.value)} />
            </div>
          )}

          <div className={styles.res} aria-live="polite">
            {nobody ? <div className={styles.help}>Pick an account type or add an address.</div>
              : checking ? <><div className={styles.skel} style={{ width: "50%" }} /><div className={styles.skel} style={{ width: "70%" }} /></>
              : plan ? (
                <>
                  <div className={styles.resBig}>{plan.contactable} of {plan.total} {plan.total === 1 ? "person" : "people"} will receive it</div>
                  {leftOut > 0 && <div className={styles.help}>{leftOut} left out</div>}
                  {Object.keys(plan.byLanguage).length > 0 && (
                    <div className={styles.chips}>{Object.entries(plan.byLanguage).map(([l, n]) => <span key={l} className={`${styles.chip} ${styles.g}`}>{langName(l)} {n}</span>)}</div>
                  )}
                  {plan.groups.length > 0 && (
                    <ul className={styles.leftOut}>
                      {plan.groups.map((g) => (
                        <li key={g.id}><b>{g.count}</b> {g.label}{g.fix ? <InfoTip label={g.label}>{g.fix}</InfoTip> : null}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
          </div>

          {waiting.length > 0 && <div className={styles.banner}>{`${waiting.join(", ")} still ${waiting.length === 1 ? "has lines" : "have lines"} to check, so ${waiting.length === 1 ? "it is" : "they are"} not sent. Those people get the fallback language.`}</div>}
          {error && <div className={styles.err} role="alert">{error}</div>}
        </>
      )}
    </SidePanel>
  );
}
