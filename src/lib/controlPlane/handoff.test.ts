import { describe, expect, it } from "vitest";
import { controlPlanePrivateKey, controlPlanePublicKeys, generateControlPlaneKeys, mintHandoffToken } from "./crypto";
import { acceptHandoff } from "./handoff";

const NOW = 1_800_000_000_000;
const k = generateControlPlaneKeys();
const priv = controlPlanePrivateKey(k.privateKeyEnv)!;
const pubs = controlPlanePublicKeys(k.publicKeyEnv);

function fakeAdmin(opts: { admins?: { email: string; user_id: string | null }[]; ledgerError?: { code?: string; message?: string } } = {}) {
  const used = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  const admins = opts.admins ?? [{ email: "owner@x.test", user_id: "u1" }];
  const admin = {
    from: (table: string) => {
      if (table === "platform_admins") {
        return { select: () => ({ eq: (_c: string, email: string) => ({ maybeSingle: async () => ({ data: admins.find((a) => a.email === email) ?? null }) }) }) };
      }
      return {
        insert: async (row: { jti: string }) => {
          if (opts.ledgerError) return { error: opts.ledgerError };
          if (used.has(row.jti)) return { error: { code: "23505", message: "duplicate" } };
          used.add(row.jti);
          rows.push(row);
          return { error: null };
        },
      };
    },
  } as never;
  return { admin, rows };
}

const mint = (over: Partial<{ sub: string; inst: string }> = {}) => mintHandoffToken(priv, { sub: "Owner@X.test", inst: "kamco", ...over }, NOW).token;

describe("acceptHandoff", () => {
  it("accepts a valid token for a platform admin of this database and records who, where, when", async () => {
    const { admin, rows } = fakeAdmin();
    expect(await acceptHandoff(admin, mint(), pubs, "kamco", NOW)).toEqual({ ok: true, userId: "u1", email: "owner@x.test" });
    expect(rows[0]).toMatchObject({ instance_slug: "kamco", subject: "owner@x.test" });
  });

  it("refuses a replayed jti", async () => {
    const { admin } = fakeAdmin();
    const token = mint();
    expect((await acceptHandoff(admin, token, pubs, "kamco", NOW)).ok).toBe(true);
    expect(await acceptHandoff(admin, token, pubs, "kamco", NOW)).toEqual({ ok: false, status: 401, reason: "replayed" });
  });

  it("refuses a subject who is not a platform admin in this database, and spends nothing", async () => {
    const { admin, rows } = fakeAdmin({ admins: [] });
    expect(await acceptHandoff(admin, mint(), pubs, "kamco", NOW)).toEqual({ ok: false, status: 403, reason: "not_platform_admin" });
    expect(rows).toHaveLength(0);
  });

  it("refuses an admin who has never signed in here (no account to open a session for)", async () => {
    const { admin } = fakeAdmin({ admins: [{ email: "owner@x.test", user_id: null }] });
    expect(await acceptHandoff(admin, mint(), pubs, "kamco", NOW)).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses a token for another instance, an expired token and a bad signature", async () => {
    const { admin } = fakeAdmin();
    expect(await acceptHandoff(admin, mint({ inst: "pcbs" }), pubs, "kamco", NOW)).toMatchObject({ ok: false, reason: "instance" });
    expect(await acceptHandoff(admin, mint(), pubs, "kamco", NOW + 200_000)).toMatchObject({ ok: false, reason: "expired" });
    expect(await acceptHandoff(admin, `${mint().split(".")[0]}.AAAA`, pubs, "kamco", NOW)).toMatchObject({ ok: false, reason: "signature" });
  });

  it("fails closed when the ledger table is missing", async () => {
    const { admin } = fakeAdmin({ ledgerError: { code: "42P01", message: "relation does not exist" } });
    expect(await acceptHandoff(admin, mint(), pubs, "kamco", NOW)).toEqual({ ok: false, status: 503, reason: "ledger_unavailable" });
  });
});
