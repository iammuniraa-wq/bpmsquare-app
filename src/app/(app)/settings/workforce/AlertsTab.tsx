"use client";

import { Input } from "@/components/ui/Input";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import type { WfmConfig } from "@/lib/constants";
import { ALERT_ROWS, type AlertKey } from "./logic";
import { More } from "./parts";
import { Switch } from "../middleware/ui";
import { WORKFORCE_TIPS as T } from "./tips";
import s from "./workforce.module.css";

/**
 * Who is told what. Phone reminders go to the employee; email goes to the supervisor when something is submitted and
 * to the employee when it is decided, as one grid instead of eight rows.
 */
export default function AlertsTab({ cfg, onChange }: { cfg: WfmConfig; onChange: (patch: Partial<WfmConfig>) => void }) {
  const long = cfg.long_day_alert ?? { enabled: false, after_hours: 9 };
  const brk = cfg.break_alert ?? { enabled: false, after_minutes: 30, message: "" };
  const hol = cfg.holiday_week_alert ?? { enabled: false };
  const n = cfg.notifications;
  const flip = (k: AlertKey, v: boolean) => onChange({ notifications: { ...n, [k]: v } });

  return (
    <div className={s.shell}>
      <div className={s.card}>
        <div className={s.sectionHead}>Phone reminders <InfoTip label="Phone reminders">{T.phone}</InfoTip></div>
        <div className={s.remind}>
          <span className={s.remindText}>
            Punch-out reminder after
            <Input
              type="number" min={1} max={24} step={0.5} aria-label="Hours worked before the punch-out reminder" disabled={!long.enabled}
              value={long.after_hours ?? 9}
              onChange={(e) => onChange({ long_day_alert: { enabled: true, after_hours: Number(e.target.value) || 9 } })}
            />
            hours <InfoTip label="Punch-out reminder">{T.longDay}</InfoTip>
          </span>
          <Switch label="Punch-out reminder" checked={long.enabled === true} onChange={(enabled) => onChange({ long_day_alert: { enabled, after_hours: long.after_hours ?? 9 } })} />
        </div>
        <div className={s.remind}>
          <span className={s.remindText}>
            Break running long, after
            <Input
              type="number" min={5} max={240} step={5} aria-label="Minutes on break before the reminder" disabled={!brk.enabled}
              value={brk.after_minutes ?? 30}
              onChange={(e) => onChange({ break_alert: { enabled: true, after_minutes: Number(e.target.value) || 30, message: brk.message ?? "" } })}
            />
            minutes <InfoTip label="Break reminder">{T.breakAlert}</InfoTip>
          </span>
          <Switch label="Break reminder" checked={brk.enabled === true} onChange={(enabled) => onChange({ break_alert: { enabled, after_minutes: brk.after_minutes ?? 30, message: brk.message ?? "" } })} />
        </div>
        <div className={s.remind}>
          <span className={s.remindText}>Holidays coming this week, every Monday <InfoTip label="Holiday digest">{T.holidays}</InfoTip></span>
          <Switch label="Holiday digest" checked={hol.enabled === true} onChange={(enabled) => onChange({ holiday_week_alert: { enabled } })} />
        </div>
        {brk.enabled && (
          <More>
            <Field label="Wording of the break reminder" info={T.breakWording}>
              <Input
                maxLength={160} placeholder="You've been on break for 35m. Punch back in when you're ready." value={brk.message ?? ""}
                onChange={(e) => onChange({ break_alert: { enabled: true, after_minutes: brk.after_minutes ?? 30, message: e.target.value } })}
              />
            </Field>
          </More>
        )}
      </div>

      <div className={s.card}>
        <div className={s.sectionHead}>Email <InfoTip label="Email">{T.email}</InfoTip></div>
        <table className={s.matrix}>
          <thead>
            <tr><th scope="col">Tell by email when</th><th scope="col">Supervisor</th><th scope="col">Employee</th></tr>
          </thead>
          <tbody>
            {ALERT_ROWS.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                {r.both ? (
                  <td colSpan={2}>
                    <label><input type="checkbox" aria-label={`${r.label}: either side`} checked={n[r.both]} onChange={(e) => flip(r.both!, e.target.checked)} /></label>
                  </td>
                ) : (
                  <>
                    <td>{r.supervisor && <label><input type="checkbox" aria-label={`${r.label}: supervisor`} checked={n[r.supervisor]} onChange={(e) => flip(r.supervisor!, e.target.checked)} /></label>}</td>
                    <td>{r.employee && <label><input type="checkbox" aria-label={`${r.label}: employee`} checked={n[r.employee]} onChange={(e) => flip(r.employee!, e.target.checked)} /></label>}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
