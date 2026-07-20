import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { getObjectSpec } from "@/lib/import/schema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { describeDbError, readImportBody, summarise } from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";

type AdminClient = ReturnType<typeof createAdminSupabase>;

const AUTH_PAGE_SIZE = 1000;

/**
 * listUsers paginates, so a single call misses anyone past the first page.
 * Built once per request rather than per row.
 */
async function buildAuthEmailIndex(admin: AdminClient): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (error || !data?.users?.length) break;
    for (const user of data.users) {
      if (user.email) index.set(user.email.toLowerCase(), user.id);
    }
    if (data.users.length < AUTH_PAGE_SIZE) break;
  }
  return index;
}

export async function POST(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") {
    return NextResponse.json({ error: "Only admins can invite users" }, { status: 403 });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const spec = getObjectSpec("users");
  const admin = createAdminSupabase();

  const { data: members } = await admin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId);
  const memberIds = new Set((members ?? []).map((m: { user_id: string }) => m.user_id));

  const authByEmail = await buildAuthEmailIndex(admin);

  const outcomes: RowOutcome[] = [];
  const seenEmails = new Set<string>();

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "),
      });
      continue;
    }

    const { name, email, role: memberRole } = validated.values;

    if (seenEmails.has(email)) {
      outcomes.push({ rowNum, status: "skipped", reason: `${email} appears more than once in this file` });
      continue;
    }
    seenEmails.add(email);

    let userId = authByEmail.get(email);

    if (userId && memberIds.has(userId)) {
      outcomes.push({ rowNum, status: "skipped", reason: `${email} is already a member of this workspace` });
      continue;
    }

    if (!userId) {
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: name },
      });
      if (inviteErr || !invited?.user) {
        outcomes.push({ rowNum, status: "failed", reason: inviteErr?.message ?? "Could not send the invite" });
        continue;
      }
      userId = invited.user.id;
      authByEmail.set(email, userId);
    }

    const { error: linkErr } = await admin
      .from("tenant_users")
      .insert({ tenant_id: tenantId, user_id: userId, role: memberRole });

    if (linkErr) {
      if (linkErr.code === "23505") {
        outcomes.push({ rowNum, status: "skipped", reason: `${email} is already a member of this workspace` });
      } else {
        outcomes.push({ rowNum, status: "failed", reason: describeDbError(linkErr) });
      }
      continue;
    }

    memberIds.add(userId);
    outcomes.push({ rowNum, status: "inserted" });
  }

  return NextResponse.json(summarise(outcomes));
}
