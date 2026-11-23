import { createHash } from "node:crypto";
import { MemoryDb, type Row } from "@/lib/inbox/testing/memoryDb";

// A test harness for the drawing register: an in-memory workspace database that behaves like the real one where it matters
// (unique indexes, the one-open and one-released revision rules, the release function, a storage bucket) and a "member session" client that
// THROWS on any write, so a test fails the moment a route writes with the member's own session instead of the service role (the tables carry a
// select-only member policy, 0255). Test helper only: nothing outside *.test.ts imports it.

export const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const T1 = id(1);
export const T2 = id(2);
export const U_PREP = id(11);     // prepares and submits
export const U_APPR = id(12);     // a named approver
export const U_ADMIN = id(13);    // workspace admin
export const U_OTHER = id(14);    // a member who is nothing special

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

export type Harness = ReturnType<typeof makeHarness>;

export function makeHarness() {
  const db = new MemoryDb({
    tenants: [{ id: T1, features: { drawing_register: true, gcc_tender: true, pipeline: true } }, { id: T2, features: { drawing_register: true } }],
    tenant_users: [
      { tenant_id: T1, user_id: U_PREP, role: "member", display_name: "Priya Preparer" },
      { tenant_id: T1, user_id: U_APPR, role: "member", display_name: "Anil Approver" },
      { tenant_id: T1, user_id: U_ADMIN, role: "admin", display_name: "Alma Admin" },
      { tenant_id: T1, user_id: U_OTHER, role: "member", display_name: "Omar Other" },
    ],
  });
  db.unique("drawings", (a, b) => a.tenant_id === b.tenant_id && String(a.drawing_no).toLowerCase() === String(b.drawing_no).toLowerCase());
  db.unique("drawings", (a, b) => a.tenant_id === b.tenant_id && !!a.ref && a.ref === b.ref);
  db.unique("drawing_types", (a, b) => a.tenant_id === b.tenant_id && String(a.name).toLowerCase() === String(b.name).toLowerCase());
  db.unique("drawing_revisions", (a, b) => a.drawing_id === b.drawing_id && a.rev_no === b.rev_no);
  db.unique("drawing_revisions", (a, b) => a.drawing_id === b.drawing_id && String(a.rev_label).toLowerCase() === String(b.rev_label).toLowerCase());
  db.unique("drawing_revisions", (a, b) => a.drawing_id === b.drawing_id && ["draft", "in_review"].includes(String(a.status)) && ["draft", "in_review"].includes(String(b.status)));

  const state = {
    db,
    tenantId: T1,
    user: { id: U_PREP, email: "priya@t1.test" },
    role: "member" as "admin" | "member",
    view: true,
    edit: true,
    features: { drawing_register: true, gcc_tender: true, pipeline: true } as Record<string, boolean>,
    changes: [] as { objectType: string; objectId: string; objectLabel?: string | null; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
    memberWrites: [] as string[],
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    failRpc: null as null | { code?: string; message: string },
  };

  /** The service-role client: the database plus the storage and rpc the register uses. */
  const admin = () => ({
    from: (t: string) => db.from(t),
    auth: db.auth,
    storage: {
      from: (bucket: string) => ({
        ...db.storage.from(bucket),
        createSignedUploadUrl: async (path: string) => ({ data: { token: `tok:${path}`, signedUrl: `https://upload.test/${bucket}/${path}`, path }, error: null }),
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      if (state.failRpc) return { data: null, error: state.failRpc };
      if (fn !== "release_drawing_revision") return { data: null, error: { code: "42883", message: "function does not exist" } };
      return releaseFunction(db, args);
    },
  });

  /** The member's own session: reads work, every write throws and is recorded. */
  const session = () => ({
    from: (t: string) => {
      const q = db.from(t) as unknown as Record<string, unknown>;
      return new Proxy(q, {
        get(target, prop) {
          if (["insert", "update", "delete", "upsert"].includes(String(prop))) return () => { state.memberWrites.push(`${String(prop)} ${t}`); throw new Error(`a member session must not write ${t}`); };
          const v = target[prop as string];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    },
    rpc: () => { state.memberWrites.push("rpc"); throw new Error("a member session must not call a function"); },
  });

  const rows = (t: string) => db.rows(t);
  return { state, db, admin, session, rows };
}

/** The same steps as release_drawing_revision() in 0255, so a test can drive the route end to end. migrations.test.ts holds the SQL to those steps. */
function releaseFunction(db: MemoryDb, a: Record<string, unknown>): { data: unknown; error: { code?: string; message: string } | null } {
  const rev = db.rows("drawing_revisions").find((r) => r.id === a.p_revision && r.tenant_id === a.p_tenant);
  if (!rev) return { data: null, error: { message: "Revision not found" } };
  const dwg = db.rows("drawings").find((d) => d.id === rev.drawing_id && d.tenant_id === a.p_tenant);
  if (!dwg) return { data: null, error: { message: "Drawing not found" } };
  if (rev.status !== "in_review") return { data: null, error: { message: "Only a revision in review can be released" } };
  const type = db.rows("drawing_types").find((t) => t.id === dwg.type_id && t.tenant_id === a.p_tenant);
  if (type && type.second_person !== false && rev.submitted_by === a.p_user) return { data: null, error: { message: "The person who submitted a revision cannot release it" } };
  const old = db.rows("drawing_revisions").find((r) => r.drawing_id === dwg.id && r.status === "released" && r.tenant_id === a.p_tenant);
  if (old) old.status = "superseded";
  Object.assign(rev, { status: "released", released_by: a.p_user, released_at: "2026-11-24T10:00:00.000Z", effective_from: a.p_effective ?? "2026-11-24", supersedes_rev_id: old?.id ?? null });
  dwg.current_rev_id = rev.id;
  return { data: { drawing_id: dwg.id, revision_id: rev.id, superseded_id: old?.id ?? null }, error: null };
}

export type { Row };
