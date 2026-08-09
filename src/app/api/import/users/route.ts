import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { USERS_SPEC, ROLE_LIST_SEPARATOR } from "@/lib/import/usersSchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { describeDbError, readImportBody, summarise } from "@/lib/import/server";
import { provisionStandardRoles } from "@/lib/standardRolesServer";
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

/**
 * A temporary password the admin hands to the new user. Generated here
 * rather than taken from a spreadsheet column on purpose: a sheet of
 * plaintext passwords gets forwarded and archived, which is a real security
 * problem (BUSINESS_ROLES_STANDARD_MAP.md §5). Mixed classes so it satisfies
 * any password policy, and URL-safe so it survives being pasted into chat.
 */
function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `Bpm-${body}`;
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
    return NextResponse.json({ error: "Only admins can add users" }, { status: 403 });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const spec = USERS_SPEC;
  const admin = createAdminSupabase();

  // Make sure the standard catalog exists before resolving role names, so a
  // first-ever import can reference "Sales User" without the admin having
  // opened the Roles page first.
  await provisionStandardRoles(admin, tenantId);

  const [{ data: members }, { data: roleRows }, { data: employeeRows }] = await Promise.all([
    admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId),
    admin.from("business_roles").select("id, name").eq("tenant_id", tenantId),
    admin.from("employees").select("id, employee_code").eq("tenant_id", tenantId).not("employee_code", "is", null),
  ]);
  const memberIds = new Set((members ?? []).map((m: { user_id: string }) => m.user_id));
  const roleIdByName = new Map((roleRows ?? []).map((r) => [(r.name as string).toLowerCase(), r.id as string]));
  const employeeIdByCode = new Map(
    (employeeRows ?? []).map((e) => [(e.employee_code as string).toLowerCase(), e.id as string])
  );

  const authByEmail = await buildAuthEmailIndex(admin);

  const outcomes: RowOutcome[] = [];
  const seenEmails = new Set<string>();
  const takenEmployeeIds = new Set<string>();
  // Surfaced back to the admin so they can distribute logins -- the whole
  // point of the no-email flow.
  const credentials: { email: string; password: string }[] = [];

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
    const roleNames = String(validated.values.business_roles ?? "")
      .split(ROLE_LIST_SEPARATOR)
      .map((s) => s.trim())
      .filter(Boolean);
    const employeeCode = String(validated.values.employee_code ?? "").trim();

    if (seenEmails.has(email)) {
      outcomes.push({ rowNum, status: "skipped", reason: `${email} appears more than once in this file` });
      continue;
    }
    seenEmails.add(email);

    // Resolve everything referenced by name/code BEFORE creating an auth
    // user, so a typo doesn't leave an orphan login behind.
    const resolvedRoleIds: string[] = [];
    let badRole: string | null = null;
    for (const rn of roleNames) {
      const id = roleIdByName.get(rn.toLowerCase());
      if (!id) { badRole = rn; break; }
      resolvedRoleIds.push(id);
    }
    if (badRole) {
      outcomes.push({ rowNum, status: "failed", reason: `Unknown business role "${badRole}"` });
      continue;
    }

    let employeeId: string | null = null;
    if (employeeCode) {
      employeeId = employeeIdByCode.get(employeeCode.toLowerCase()) ?? null;
      if (!employeeId) {
        outcomes.push({ rowNum, status: "failed", reason: `No employee with code "${employeeCode}"` });
        continue;
      }
      if (takenEmployeeIds.has(employeeId)) {
        outcomes.push({ rowNum, status: "failed", reason: `Employee "${employeeCode}" is used twice in this file` });
        continue;
      }
    }

    let userId = authByEmail.get(email);

    if (userId && memberIds.has(userId)) {
      outcomes.push({ rowNum, status: "skipped", reason: `${email} is already a member of this workspace` });
      continue;
    }

    if (!userId) {
      // No invite email: client-admin-added users are created directly with
      // a temporary password (client decision 2026-08-06). email_confirm
      // skips the confirmation mail too, so this sends nothing at all.
      const password = temporaryPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (createErr || !created?.user) {
        outcomes.push({ rowNum, status: "failed", reason: createErr?.message ?? "Could not create the login" });
        continue;
      }
      userId = created.user.id;
      authByEmail.set(email, userId);
      credentials.push({ email, password });
    }

    const { error: linkErr } = await admin
      .from("tenant_users")
      .insert({ tenant_id: tenantId, user_id: userId, role: memberRole, employee_id: employeeId });

    if (linkErr) {
      if (linkErr.code === "23505") {
        outcomes.push({ rowNum, status: "skipped", reason: `${email} is already a member of this workspace` });
      } else {
        outcomes.push({ rowNum, status: "failed", reason: describeDbError(linkErr) });
      }
      continue;
    }

    memberIds.add(userId);
    if (employeeId) takenEmployeeIds.add(employeeId);

    // Business Roles only narrow a "member" -- an admin bypasses them
    // entirely (permissions.ts), so assigning them to one would be
    // misleading rather than harmless.
    if (resolvedRoleIds.length > 0 && memberRole !== "admin") {
      const { error: roleErr } = await admin
        .from("business_user_roles")
        .insert(resolvedRoleIds.map((role_id) => ({ tenant_id: tenantId, user_id: userId, role_id })));
      if (roleErr) {
        outcomes.push({ rowNum, status: "failed", reason: `Login created but roles failed: ${describeDbError(roleErr)}` });
        continue;
      }
    }

    outcomes.push({ rowNum, status: "inserted" });
  }

  return NextResponse.json({ ...summarise(outcomes), credentials });
}
