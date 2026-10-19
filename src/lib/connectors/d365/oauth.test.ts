import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));

import { newPkce, challengeFor, validVerifier } from "./pkce";
import { exchangeAuthCode } from "./server";
import { fakeDb, seedConnector, TENANT } from "./syncHarness";
import type { D365Config } from "./types";

afterEach(() => { vi.unstubAllGlobals(); });

describe("PKCE (M5)", () => {
  it("derives the S256 challenge exactly as RFC 7636 appendix B does", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes a fresh, valid verifier whose challenge matches", () => {
    const a = newPkce(), b = newPkce();
    expect(validVerifier(a.verifier)).toBe(true);
    expect(a.verifier).not.toBe(b.verifier);
    expect(challengeFor(a.verifier)).toBe(a.challenge);
    expect(a.challenge).not.toContain("=");
  });

  it("refuses a missing, short or odd cookie value", () => {
    for (const v of [undefined, null, "", "short", "a".repeat(129), `${"a".repeat(43)} x`, `${"a".repeat(43)}"`]) expect(validVerifier(v as string | undefined)).toBe(false);
  });

  it("sends the verifier with the code when redeeming it", async () => {
    let body: URLSearchParams | null = null;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      body = init.body as URLSearchParams;
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 });
    });
    const db = fakeDb(seedConnector());
    const cfg = { product: "dataverse", auth_mode: "authorization_code", environment_url: "https://org.crm.dynamics.com", directory_id: "contoso.com", client_id: "00000000-0000-0000-0000-000000000000", schedule: "off", entities: {} } as D365Config;
    await exchangeAuthCode(db.client, TENANT, cfg, { client_secret: "s" }, "CODE", "https://app.example.com/cb", "V".repeat(43));
    expect(body!.get("code_verifier")).toBe("V".repeat(43));
    expect(body!.get("code")).toBe("CODE");
    expect(body!.get("grant_type")).toBe("authorization_code");
  });
});
