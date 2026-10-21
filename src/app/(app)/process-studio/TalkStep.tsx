"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { studySummary } from "@/lib/studio/summary";
import { studioApi, STUDIO_BASE, type StepProps } from "./studioClient";
import { STUDIO_TIPS, sendTip } from "@/lib/studio/tips";
import { Head, OptionGroup, Opt } from "./ui";
import styles from "./studio.module.css";

export const SEND_EVENT = "studio:send";

export default function TalkStep({ bundle, canEdit, toast, refresh }: StepProps) {
  const { study, requests } = bundle;
  const [name, setName] = useState(study.contact_name ?? "");
  const [email, setEmail] = useState(study.contact_email ?? "");
  const [sending, setSending] = useState(false);
  const [again, setAgain] = useState(false);

  const sum = studySummary({ study, steps: bundle.steps, fit: bundle.fit, changes: bundle.changes, tasks: bundle.tasks, comments: bundle.comments });
  const latest = requests[requests.length - 1];
  const sent = study.current_version > 0 && !!latest && latest.version === study.current_version && study.status !== "telling" && !again;
  const nextVersion = study.current_version + 1;

  async function send() {
    if (sending) return;
    if (!name.trim() || !email.trim()) { toast("Add your name and an email for the call-back first."); document.getElementById("psd-cname")?.focus(); return; }
    setSending(true);
    const res = await studioApi<{ version: number }>("POST", `${STUDIO_BASE}/${study.id}/send`, { name, email });
    setSending(false);
    if (!res.ok) { toast(res.error); return; }
    setAgain(false);
    toast(`Sent to BPMSquare. Version ${res.data.version} is frozen.`);
    refresh();
  }

  useEffect(() => {
    const h = () => { void send(); };
    window.addEventListener(SEND_EVENT, h);
    return () => window.removeEventListener(SEND_EVENT, h);
    // send reads the current name and email through its closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, email, sending]);

  return (
    <>
      <aside className={styles.panel} aria-label="Options">
        <OptionGroup id="p6send" title="Send to BPMSquare" info={sendTip(nextVersion)} defaultOpen>
          <Opt label="Your name" htmlFor="psd-cname" info={STUDIO_TIPS.contactName}>
            <Input id="psd-cname" value={name} maxLength={120} disabled={!canEdit || sent} onChange={(e) => setName(e.target.value)} />
          </Opt>
          <Opt label="Email for the call-back" htmlFor="psd-cmail" info={STUDIO_TIPS.contactEmail}>
            <Input id="psd-cmail" type="email" value={email} maxLength={200} disabled={!canEdit || sent} onChange={(e) => setEmail(e.target.value)} />
          </Opt>
          {sent ? (
            <div className={styles.sent} role="status">
              Sent. We will contact {study.contact_name || name} within two working days. Version {study.current_version} is frozen.
              {canEdit && <div><Button size="sm" variant="quiet" onClick={() => setAgain(true)}>Send a new version</Button></div>}
            </div>
          ) : (
            <Button variant="primary" loading={sending} disabled={!canEdit} style={{ width: "100%" }} onClick={() => void send()}>Send to BPMSquare</Button>
          )}
        </OptionGroup>

        <OptionGroup title="Download" info={STUDIO_TIPS.download}>
          <Opt label="PDF" info={STUDIO_TIPS.pdf}>
            <Button href={`${STUDIO_BASE}/${study.id}/pdf`} style={{ width: "100%" }}>Download PDF</Button>
          </Opt>
        </OptionGroup>
      </aside>

      <div className={styles.work}>
        <Head title="Talk to us" info={STUDIO_TIPS.talkHead} />
        <Card>
          <div id="w6sum">
            <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>{study.name}</h3>
            {study.summary && <p style={{ margin: "0 0 10px" }}>{study.summary}</p>}
            <div className={styles.sum}>
              <div><span>Standard or setup</span><b>{sum.standardOrSetup} of {sum.steps}</b></div>
              <div><span>Need a change</span><b>{sum.needChange}</b></div>
              <div><span>Changes kept</span><b>{sum.changesKept} of {sum.changesTotal}</b></div>
              <div><span>Plan</span><b>{sum.planDays} working days</b></div>
              <div><span>Phases you ticked</span><b>{sum.phasesTicked} of {sum.phasesTotal}</b></div>
            </div>
          </div>
        </Card>
        <Card title="What happens next">
          <div className={styles.next}>
            <div><i>1</i><span>We read your study and check every line of the fit report. Anything we change you see marked Reviewed by BPMSquare.</span></div>
            <div><i>2</i><span>We call within two working days to go through the changes and the plan.</span></div>
            <div><i>3</i><span>If you go ahead, the modules in your plan are switched on in your workspace and the plan becomes your onboarding plan.</span></div>
          </div>
        </Card>
      </div>
    </>
  );
}
