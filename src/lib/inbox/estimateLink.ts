import "server-only";
import { inboxAccess, loadEmailForViewer, type InboxCtx } from "./server";
import { emailAsBrief } from "./rules";
import { finishConversion, matchSender } from "./convert";

// The estimate side of "Create from this email". An estimate is made in the estimate workspace (templates, inputs, a
// price), so the Inbox cannot create it in one step the way it creates a Case or a Lead. It does two things instead:
//   * on the way in, hands the workspace the email as the pasted brief (and the account the sender belongs to);
//   * on the way out, when the estimate is saved, links the message to it, copies the files and marks it handled.
// Both go through the same checks as the Inbox itself: the module is on, the person is on the channel's team.

export type EstimatePrefill = { brief: string; accountId: string | null; contactId: string | null; customer: string | null };

/** The email as an intake brief for a person who may read it; null otherwise (the workspace then opens empty). Never throws. */
export async function loadEstimatePrefill(emailId: string): Promise<EstimatePrefill | null> {
  try {
    const ctx = await inboxAccess(false);
    const found = await loadEmailForViewer(ctx, emailId);
    if (!found || found.email.direction !== "in" || found.email.purged_at || found.email.linked_object_id) return null;
    const m = await matchSender(ctx.admin, ctx.tenantId, found.email.from_address);
    return {
      brief: emailAsBrief(found.email),
      accountId: m?.accountId ?? null, contactId: m?.contactId ?? null,
      customer: m?.accountName ?? found.email.from_name ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * After an estimate has been saved from an email: link the two. Ignored (never an error) when the id is not a message
 * this person may convert, so a hand-edited request cannot link an estimate to someone else's mail. Never throws.
 */
export async function linkEstimateToEmail(args: { sourceEmailId: unknown; estimate: { id: string; label: string }; accountId?: string | null }): Promise<{ linked: boolean; copied: number }> {
  try {
    if (typeof args.sourceEmailId !== "string" || !/^[0-9a-f-]{36}$/i.test(args.sourceEmailId)) return { linked: false, copied: 0 };
    const ctx: InboxCtx = await inboxAccess(true);
    const found = await loadEmailForViewer(ctx, args.sourceEmailId);
    if (!found || found.email.direction !== "in" || found.email.purged_at || found.email.linked_object_id) return { linked: false, copied: 0 };
    const r = await finishConversion(ctx.admin, {
      tenantId: ctx.tenantId, emailId: args.sourceEmailId, objectType: "estimates", objectId: args.estimate.id, objectLabel: args.estimate.label,
      accountId: args.accountId ?? null, actor: { id: ctx.userId, email: ctx.email },
    });
    return r.ok ? { linked: true, copied: r.copied } : { linked: false, copied: 0 };
  } catch {
    return { linked: false, copied: 0 };
  }
}
