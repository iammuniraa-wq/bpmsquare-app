import Link from "next/link";
import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import ListFilterBar from "@/components/ListFilterBar";
import PagerLink from "@/components/PagerLink";
import InfoTip from "@/components/ui/InfoTip";
import Button from "@/components/ui/Button";
import { QualityTag, StatusTag, Tag, senderName, whenWord } from "@/components/inbox/bits";
import s from "@/components/inbox/inbox.module.css";
import { inboxAccess, listEmails, PENDING_MESSAGE } from "@/lib/inbox/server";
import { INBOX_STATUSES, INBOX_STATUS_LABEL, INBOX_LIMITS, OBJECT_LABEL, type InboxStatus } from "@/lib/inbox/types";
import { INBOX_TIPS } from "@/lib/inbox/tips";

// The shared Inbox: customer mail from the addresses the signed-in person is on the team of. Server-rendered and
// filtered by the URL (channel, status, search, page), so a filtered view can be shared and the back button works.
// The list carries a short snippet only; the whole message is one click away.

type SP = { channel?: string; status?: string; q?: string; page?: string; mine?: string };

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireWorkcenterView("inbox");
  await requireFeature("inbox");
  const sp = await searchParams;
  let ctx;
  try {
    ctx = await inboxAccess(false);
  } catch {
    redirect(ROUTES.dashboard);
  }

  const status: InboxStatus | "all" = (INBOX_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as InboxStatus) : "all";
  const mine = sp.mine === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await listEmails(ctx, { channel: sp.channel, status, q: sp.q, page, mine: mine ? ctx.userId : null });
  const now = new Date();

  // A link that keeps the channel and the search and changes only what is named.
  const hrefFor = (over: { status?: InboxStatus | "all"; mine?: boolean }) => {
    const p = new URLSearchParams();
    if (sp.channel) p.set("channel", sp.channel);
    if (sp.q) p.set("q", sp.q);
    const st = over.status ?? status;
    if (st !== "all") p.set("status", st);
    if (over.mine ?? mine) p.set("mine", "1");
    const qs = p.toString();
    return qs ? `${ROUTES.inbox}?${qs}` : ROUTES.inbox;
  };
  const total = data.counts.new + data.counts.handled + data.counts.spam;
  const settingsLink = ctx.role === "admin" ? <Button href={ROUTES.settingsInbox} variant="secondary" size="sm">Channels</Button> : null;

  return (
    <>
      <TabTitle title="Inbox" />
      <PageHeader title="Inbox" info={INBOX_TIPS.page} action={settingsLink} />

      {data.missing && <div className={`${s.notice} ${s.noticeErr}`} role="status">{PENDING_MESSAGE}</div>}

      {!data.missing && data.channels.length === 0 && (
        <div className={s.list}>
          <div className={s.empty}>
            <strong>No address yet.</strong>
            <div style={{ marginTop: 6 }}>
              {ctx.role === "admin" ? "Add a channel to get an address customers can write to." : "No address has been set up for a team you are on."}
            </div>
            {ctx.role === "admin" && <div style={{ marginTop: 12 }}><Button href={ROUTES.settingsInbox} variant="primary">Add a channel</Button></div>}
          </div>
        </div>
      )}

      {!data.missing && data.channels.length > 0 && (
        <>
          <div data-guide="inbox.status" className={s.chips} role="group" aria-label="Status">
            <Link href={hrefFor({ status: "all" })} className={`${s.chip} ${status === "all" ? s.chipOn : ""}`} aria-current={status === "all" ? "true" : undefined}>
              All <span className={s.chipCount}>{total}</span>
            </Link>
            {INBOX_STATUSES.map((st) => (
              <Link key={st} href={hrefFor({ status: st })} className={`${s.chip} ${status === st ? s.chipOn : ""}`} aria-current={status === st ? "true" : undefined}>
                {INBOX_STATUS_LABEL[st]} <span className={s.chipCount}>{data.counts[st]}</span>
              </Link>
            ))}
            <Link href={hrefFor({ mine: !mine })} className={`${s.chip} ${mine ? s.chipOn : ""}`} aria-pressed={mine}>Assigned to me</Link>
            <InfoTip label="Status">{INBOX_TIPS.status}</InfoTip>
          </div>

          <div data-guide="inbox.channel">
            <div data-guide="inbox.search">
              <ListFilterBar
                searchValue={sp.q}
                searchPlaceholder="Search sender or subject"
                selects={data.channels.length > 1 ? [{
                  name: "channel", value: sp.channel, placeholder: "All addresses",
                  options: data.channels.map((c) => ({ value: c.id, label: c.name })),
                }] : []}
                hiddenParams={{ status: status === "all" ? undefined : status, mine: mine ? "1" : undefined }}
                clearHref={ROUTES.inbox}
              />
            </div>
          </div>

          <div className={s.list} role="list" aria-label="Emails">
            {data.emails.length === 0 ? (
              <div className={s.empty}>
                {sp.q || sp.channel || status !== "all" || mine ? "Nothing matches these filters." : "No mail yet. It appears here as soon as someone writes to one of your addresses."}
              </div>
            ) : data.emails.map((e) => {
              const unread = e.status === "new" && !e.read_at;
              return (
                <Link key={e.id} href={ROUTES.inboxMessage(e.id)} className={s.row} role="listitem" data-guide="inbox.row">
                  <span className={`${s.dot} ${unread ? s.dotNew : ""}`} aria-hidden="true" />
                  <span className={s.main}>
                    <span className={`${s.from} ${unread ? s.fromNew : ""}`}>{senderName(e)}</span>
                    <span className={s.subject}>{e.subject || "(no subject)"}</span>
                    <span className={s.snippet}>{e.purged_at ? "Text cleared after its retention period" : e.snippet ?? ""}</span>
                    <span className={s.tags}>
                      {data.channels.length > 1 && <Tag>{e.channel_name}</Tag>}
                      {e.attachments.count > 0 && e.attachments.worst && (
                        <>
                          <Tag>{e.attachments.count} file{e.attachments.count === 1 ? "" : "s"}</Tag>
                          <QualityTag quality={e.attachments.worst} />
                        </>
                      )}
                      {e.replies > 0 && <Tag>Replied</Tag>}
                      {e.linked_object_type && <Tag>{OBJECT_LABEL[e.linked_object_type]}: {e.linked_object_label ?? "linked"}</Tag>}
                    </span>
                  </span>
                  <span className={s.meta}>
                    <span>{whenWord(e.received_at, now)}</span>
                    {e.status !== "new" && <StatusTag status={e.status} />}
                  </span>
                </Link>
              );
            })}
          </div>

          <PagerLink
            page={data.page} total={data.total} pageSize={INBOX_LIMITS.pageSize} baseHref={ROUTES.inbox}
            hiddenParams={{ channel: sp.channel, q: sp.q, mine: mine ? "1" : undefined, status: status === "all" ? undefined : status }}
          />
        </>
      )}
    </>
  );
}
