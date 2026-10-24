import s from "./inbox.module.css";
import { INBOX_STATUS_LABEL, QUALITY_LABEL, type InboxStatus, type QualityLabel } from "@/lib/inbox/types";

// Small pieces both the server-rendered list and the client thread draw. Markup only: no hooks, no data fetching. Every
// string that comes from mail (a sender, a subject) is passed as a React child, so it is escaped.

const QUALITY_CLASS: Record<QualityLabel, string> = { good: s.tagGood, review: s.tagReview, poor: s.tagPoor };
const STATUS_CLASS: Record<InboxStatus, string> = { new: s.tagBlue, handled: s.tagGreen, spam: s.tagRed };

export function QualityTag({ quality }: { quality: QualityLabel }) {
  return <span className={`${s.tag} ${QUALITY_CLASS[quality]}`}>{QUALITY_LABEL[quality]}</span>;
}

export function StatusTag({ status }: { status: InboxStatus }) {
  return <span className={`${s.tag} ${STATUS_CLASS[status]}`}>{INBOX_STATUS_LABEL[status]}</span>;
}

export function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className={s.tag} title={title}>{children}</span>;
}

/** "5 min ago", "3 h ago", "Tue 14:05", "12 Oct". Pure over (iso, now), so the server and the tests agree. */
export function whenWord(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const ms = now.getTime() - d.getTime();
  if (!Number.isFinite(ms)) return "";
  const min = ms / 60_000;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.floor(min)} min ago`;
  if (min < 1440) return `${Math.floor(min / 60)} h ago`;
  if (min < 7 * 1440) return d.toLocaleDateString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: min > 330 * 1440 ? "numeric" : undefined });
}

export const senderName = (e: { from_name: string | null; from_address: string | null }) => e.from_name || e.from_address || "Unknown sender";

export const sizeWord = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
