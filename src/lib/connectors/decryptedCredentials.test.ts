import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getDecryptedCredentials } from "./server";
import { encrypt } from "@/lib/encryption";

function client(row: unknown) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row }) };
  return { from: () => q } as never;
}

describe("getDecryptedCredentials", () => {
  it("returns the Gmail address kept in config together with the decrypted app password", async () => {
    const row = { credentials: { app_password: encrypt("abcd efgh ijkl mnop") }, config: { email: "me@gmail.com" } };
    const creds = await getDecryptedCredentials(client(row), "t1", "gmail");
    expect(creds).toEqual({ email: "me@gmail.com", app_password: "abcd efgh ijkl mnop" });
  });

  it("lets a secret win over a config value of the same name", async () => {
    const row = { credentials: { token: encrypt("secret") }, config: { token: "plain" } };
    expect((await getDecryptedCredentials(client(row), "t1", "x"))?.token).toBe("secret");
  });

  it("is null when the connector is not connected, and tolerates an empty config", async () => {
    expect(await getDecryptedCredentials(client(null), "t1", "gmail")).toBeNull();
    const row = { credentials: { webhook_url: encrypt("https://hooks.example/x") }, config: null };
    expect(await getDecryptedCredentials(client(row), "t1", "slack")).toEqual({ webhook_url: "https://hooks.example/x" });
  });
});
