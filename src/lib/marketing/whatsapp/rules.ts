import type { TenantConfig } from "@/lib/constants";
import { normalisePhone } from "./phone";

// The WhatsApp rules, as code, pure. The send function and the tests both call these; nothing here reads
// a database.

export const SESSION_WINDOW_MS = 24 * 3_600_000;
export const WEEK_MS = 7 * 86_400_000;
export const DEFAULT_WEEKLY_CAP = 1;

/** WhatsApp lets free-form text go out only within 24 hours of the person's last message to you. */
export function windowOpen(lastInboundAt: string | Date | null | undefined, now: Date): boolean {
  if (!lastInboundAt) return false;
  const t = lastInboundAt instanceof Date ? lastInboundAt.getTime() : Date.parse(lastInboundAt);
  return Number.isFinite(t) && t <= now.getTime() && now.getTime() - t < SESSION_WINDOW_MS;
}

export type SendRuleInput = {
  kind: "template" | "session";
  /** A person working from the record, or an automation (a journey). */
  actor: "rep" | "journey";
  lastInboundAt: string | Date | null | undefined;
  templateStatus?: string | null;
  now: Date;
};
export type SendRuleResult = { ok: true } | { ok: false; reason: "template_not_approved" | "window_closed" | "session_needs_person" };

/**
 * May this kind of message go out right now? A template must be approved, any time. Free text needs an open
 * 24-hour window AND a person: a journey never sends free text (docs/marketing-platform-architecture.md 7).
 */
export function sendRule(i: SendRuleInput): SendRuleResult {
  if (i.kind === "template") return i.templateStatus === "approved" ? { ok: true } : { ok: false, reason: "template_not_approved" };
  if (i.actor !== "rep") return { ok: false, reason: "session_needs_person" };
  return windowOpen(i.lastInboundAt, i.now) ? { ok: true } : { ok: false, reason: "window_closed" };
}

export function weeklyCapOf(config: Partial<TenantConfig> | null | undefined): number {
  const n = config?.whatsapp?.weekly_cap;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(20, Math.max(1, Math.round(n))) : DEFAULT_WEEKLY_CAP;
}

/** At most `cap` marketing messages per person in any 7 days. Returns when the next one is allowed. */
export function capCheck(sentTimes: Date[], now: Date, cap: number): { ok: true } | { ok: false; resumeAt: Date } {
  const recent = sentTimes.filter((t) => now.getTime() - t.getTime() < WEEK_MS).sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < cap) return { ok: true };
  // The message that frees a slot is the one `cap` places from the newest.
  const frees = recent[recent.length - cap];
  return { ok: false, resumeAt: new Date(frees.getTime() + WEEK_MS) };
}

// ── Keywords ─────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit", "stopall", "إيقاف", "ايقاف", "إلغاء", "الغاء", "إلغاء الاشتراك", "الغاء الاشتراك"]);
const START_WORDS = new Set(["start", "subscribe", "unstop", "ابدأ", "اشتراك"]);

/** Only a message that is JUST the keyword counts: "please stop calling me about the quote" is a reply, not an instruction we guess at. */
export function classifyKeyword(text: string | null | undefined): "stop" | "start" | null {
  if (typeof text !== "string") return null;
  const t = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (STOP_WORDS.has(t)) return "stop";
  if (START_WORDS.has(t)) return "start";
  return null;
}

// ── Demo workspaces ──────────────────────────────────────────────────────────

export type WhatsappOutput = { mode: "live" } | { mode: "redirect"; to: string } | { mode: "dry_run" };

/**
 * Where a message really goes. A demo workspace never reaches a customer's number: it goes to the workspace's
 * test number if one is set, otherwise it is only logged. Not something a workspace admin can switch off.
 */
export function whatsappOutputFor(tenant: { isDemo: boolean; config: Partial<TenantConfig> | null | undefined }): WhatsappOutput {
  if (!tenant.isDemo) return { mode: "live" };
  const to = normalisePhone(tenant.config?.whatsapp?.redirect_number ?? null);
  return to ? { mode: "redirect", to } : { mode: "dry_run" };
}
