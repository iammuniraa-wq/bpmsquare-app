import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee } from "@/lib/wfm/server";
import { encrypt, decrypt } from "@/lib/encryption";

// GET/PUT /api/wfm/me/bank — the employee's OWN bank details (portal
// Profile → Your Bank Details). Self-service only: both verbs resolve the
// employee from the session (requireWfmEmployee), never from a client id.
// account_number and upi_id are encrypted at rest via lib/encryption; reads
// decrypt before returning — this is the employee reading their own data.

const IFSC_RE = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
const ACCT_RE = /^\d{9,18}$/;

export async function GET() {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("employee_bank_details")
    .select("account_holder, bank_name, account_number, ifsc, upi_id, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("employee_id", ctx.employee.id)
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({ error: "Bank details aren't set up on the server yet." }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ bank: null });
  return NextResponse.json({
    bank: {
      account_holder: data.account_holder,
      bank_name: data.bank_name,
      account_number: decrypt(data.account_number ?? "") || null,
      ifsc: data.ifsc,
      upi_id: decrypt(data.upi_id ?? "") || null,
      updated_at: data.updated_at,
    },
  });
}

export async function PUT(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const accountHolder = clean(body.account_holder, 120);
  const bankName = clean(body.bank_name, 120);
  const accountNumber = clean(body.account_number, 24).replace(/\s+/g, "");
  const ifsc = clean(body.ifsc, 11).toUpperCase();
  const upiId = clean(body.upi_id, 80);

  if (accountNumber && !ACCT_RE.test(accountNumber)) {
    return NextResponse.json({ error: "Account number should be 9–18 digits." }, { status: 400 });
  }
  if (ifsc && !IFSC_RE.test(ifsc)) {
    return NextResponse.json({ error: "That doesn't look like a valid IFSC (e.g. HDFC0001234)." }, { status: 400 });
  }
  if (upiId && !upiId.includes("@")) {
    return NextResponse.json({ error: "A UPI ID looks like name@bank." }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { error } = await admin.from("employee_bank_details").upsert(
    {
      tenant_id: ctx.tenantId,
      employee_id: ctx.employee.id,
      account_holder: accountHolder || null,
      bank_name: bankName || null,
      account_number: accountNumber ? encrypt(accountNumber) : null,
      ifsc: ifsc || null,
      upi_id: upiId ? encrypt(upiId) : null,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,employee_id" }
  );
  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({ error: "Bank details aren't set up on the server yet." }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
