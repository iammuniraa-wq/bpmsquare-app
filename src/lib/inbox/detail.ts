import "server-only";
import { canCreateWorkcenter } from "@/lib/permissions";
import { diffForLog, logChange } from "@/lib/changeLog";
import { emitEmailHandled } from "@/lib/events/emitters";
import {
  assignableMembers, loadAttachments, loadEmailForViewer, loadThread, type InboxCtx,
} from "./server";
import { matchSender } from "./convert";
import { LINK_ACCESS } from "./links";
import { needsBetterDrawing, orderCreateTypes, parseAddress, suggestedAccountName } from "./rules";
import { CREATE_TO_OBJECT, CREATE_TYPES, type CreateOption, type InboxChannel, type InboxDetailView, type InboxStatus } from "./types";
import type { toEmail } from "./server";

type Email = ReturnType<typeof toEmail>;

export type Detail = InboxDetailView;

/** Which "Create" targets this person may use: the module is on in the workspace and their role may create there. */
export function createOptionsFor(ctx: Pick<InboxCtx, "features" | "perms">, channel: Pick<InboxChannel, "default_action">): CreateOption[] {
  // "Deal" exists only in a workspace with the tender edition: for everyone else the menu is the five it always was.
  const offered = CREATE_TYPES.filter((type) => type !== "deal" || ctx.features.gcc_tender === true);
  return orderCreateTypes(offered, channel.default_action).map((type) => {
    const access = LINK_ACCESS[CREATE_TO_OBJECT[type]];
    if (!ctx.features[access.feature as keyof typeof ctx.features] || (access.also && !ctx.features[access.also as keyof typeof ctx.features])) {
      return { type, available: false, reason: type === "estimate" ? "Estimates not available" : "Not part of your workspace" };
    }
    if (!canCreateWorkcenter(ctx.perms, access.workcenter)) return { type, available: false, reason: "Your role cannot create these" };
    return { type, available: true, reason: null };
  });
}

/** One message, its conversation and everything the screen needs, only if the person may see the channel. */
export async function loadDetail(ctx: InboxCtx, id: string): Promise<Detail | null> {
  const found = await loadEmailForViewer(ctx, id);
  if (!found) return null;
  const { email, channel } = found;
  const thread = await loadThread(ctx, email);
  const attachments = await loadAttachments(ctx, thread.map((m) => m.id));
  const from = parseAddress(email.from_address ? `${email.from_name ? `${email.from_name} ` : ""}<${email.from_address}>` : null);
  const match = await matchSender(ctx.admin, ctx.tenantId, email.from_address);
  const members = await assignableMembers(ctx.admin, ctx.tenantId, channel);
  const inbound = attachments.filter((a) => thread.some((m) => m.id === a.email_id && m.direction === "in"));
  return {
    email, channel, thread, attachments,
    sender: { name: from.name ?? email.from_name, address: from.address ?? email.from_address, suggestedName: suggestedAccountName({ name: from.name ?? email.from_name, address: from.address ?? email.from_address }, email.body_text), match },
    createOptions: createOptionsFor(ctx, channel),
    members,
    needsBetterDrawing: needsBetterDrawing(inbound),
    estimatesAvailable: !!ctx.features.estimator && canCreateWorkcenter(ctx.perms, "estimates"),
  };
}

/** Opening a message reads it. Quiet: a failure here never stops the screen. */
export async function markRead(ctx: Pick<InboxCtx, "admin" | "tenantId">, email: { id: string; direction: "in" | "out"; read_at: string | null }): Promise<void> {
  if (email.direction !== "in" || email.read_at) return;
  await ctx.admin.from("inbound_emails").update({ read_at: new Date().toISOString() }).eq("id", email.id).eq("tenant_id", ctx.tenantId).is("read_at", null);
}

export type PatchInput = { status?: unknown; assigned_to?: unknown };

/** Mark handled / spam / new, or assign. Only fields from the allow-list; the assignee must be on the channel's team. */
export async function patchEmail(ctx: InboxCtx, id: string, input: PatchInput): Promise<{ ok: true; email: Email } | { ok: false; error: string; status: number }> {
  const found = await loadEmailForViewer(ctx, id);
  if (!found) return { ok: false, error: "Message not found.", status: 404 };
  const { email, channel } = found;
  if (email.direction !== "in") return { ok: false, error: "Only a customer's message has a status.", status: 422 };

  const patch: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const now = new Date().toISOString();

  if (input.status !== undefined) {
    if (input.status !== "new" && input.status !== "handled" && input.status !== "spam") return { ok: false, error: "status must be new, handled or spam.", status: 422 };
    const status = input.status as InboxStatus;
    if (status !== email.status) {
      patch.status = status;
      patch.handled_at = status === "new" ? null : now;
      patch.handled_by = status === "new" ? null : ctx.userId;
      before.status = email.status; after.status = status;
    }
  }
  if (input.assigned_to !== undefined) {
    const to = input.assigned_to;
    if (to !== null && typeof to !== "string") return { ok: false, error: "assigned_to must be a person or null.", status: 422 };
    if (to) {
      const team = await assignableMembers(ctx.admin, ctx.tenantId, channel);
      if (!team.some((m) => m.user_id === to)) return { ok: false, error: "That person is not on this channel's team.", status: 422 };
    }
    if ((to ?? null) !== email.assigned_to) { patch.assigned_to = to ?? null; before.assigned_to = email.assigned_to; after.assigned_to = to ?? null; }
  }
  if (Object.keys(patch).length === 0) return { ok: true, email };

  const { error } = await ctx.admin.from("inbound_emails").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message, status: 500 };
  await logChange(ctx.admin, {
    tenantId: ctx.tenantId, objectType: "inbound_emails", objectId: id, objectLabel: `${channel.name} · email ${id.slice(0, 8)}`,
    action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: diffForLog("inbound_emails", before, after),
  });
  if (patch.status === "handled" || patch.status === "spam") {
    await emitEmailHandled(ctx.tenantId, { emailId: id, channelId: channel.id, status: patch.status as "handled" | "spam", via: "manual", actorId: ctx.userId });
  }
  return { ok: true, email: { ...email, ...(patch as Partial<Email>) } };
}
