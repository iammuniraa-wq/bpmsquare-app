import Link from "next/link";
import s from "./crew.module.css";

/** The "Watch" pill on a tender deal header: a link to the suggestion(s) Tender Watch has for this deal. */
export default function WatchPill({ href, count }: { href: string; count: number }) {
  return (
    <Link href={href} className={s.watch} data-guide="crew.watch_pill" aria-label={`Tender Watch has ${count} suggestion${count === 1 ? "" : "s"} for this tender`}>
      <span aria-hidden>●</span> Watch{count > 1 ? ` (${count})` : ""}
    </Link>
  );
}
