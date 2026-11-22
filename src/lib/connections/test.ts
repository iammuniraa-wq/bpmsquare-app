import "server-only";
import { listEntitySets } from "@/lib/middleware/schema/odata";
import { assertSafeHttpsUrl } from "@/lib/net/safeHost";
import { describeHttpFailure, describeNetworkError, EMPTY_ANSWER, NOT_DATA, fail, pass } from "./plain";
import { callConnection, type LiveConnection, type TokenStore } from "./request";
import type { TestResult } from "./spec";

// The one Test of a connection (a panel's step 3, and the row action). A REST connection reads its check path (or the address
// itself); an OData service reads $metadata, which also proves the service is OData and counts what it offers. The result is the
// words a person acts on; nothing about the answer is returned except a short vendor code.

const looksLikeHtml = (contentType: string, text: string) => /html/i.test(contentType) || /^\s*<(!doctype html|html)\b/i.test(text.slice(0, 200));

export async function runConnectionTest(c: LiveConnection & { family: "rest" | "odata" }, store?: TokenStore): Promise<TestResult> {
  // The address was checked when it was saved; it is checked again here because DNS can change and a draft has not been saved.
  for (const u of [c.config.base_url, c.config.oauth_provider === "custom" ? c.config.token_url : undefined]) {
    if (!u) continue;
    try { await assertSafeHttpsUrl(u); } catch (e) { return describeNetworkError(e); }
  }

  const odata = c.family === "odata";
  const out = await callConnection(c, { path: odata ? "/$metadata" : (c.config.test_path ?? ""), headers: odata ? { Accept: "application/xml, text/xml;q=0.9" } : {} }, store);
  if (!out.ok) return out.result;
  if (out.status < 200 || out.status >= 300) return describeHttpFailure(out.status, out.text, odata ? "odata" : "rest");

  if (odata) {
    if (!out.text.trim()) return EMPTY_ANSWER(out.status);
    if (looksLikeHtml(out.contentType, out.text) && !/<(edmx:)?Edmx\b/i.test(out.text)) return NOT_DATA(out.status);
    if (!/<(edmx:)?Edmx\b|<Schema\b|<EntityType\b/i.test(out.text)) {
      return fail("The address answered, but not with an OData description.", "The service address should end where $metadata can be read, such as .../data or .../api/data/v9.2.", { httpStatus: out.status });
    }
    const sets = listEntitySets(out.text).length;
    return pass(sets > 0 ? `Connected. The service offers ${sets} entity ${sets === 1 ? "set" : "sets"}.` : "Connected, but the service lists no entity sets.", { httpStatus: out.status, note: `${sets} entity sets` });
  }

  if (out.status === 204) return pass("Connected.", { httpStatus: 204 });
  if (!out.text.trim()) return pass("Connected. The system answered, but with an empty body.", { httpStatus: out.status, note: "empty body" });
  if (looksLikeHtml(out.contentType, out.text)) return NOT_DATA(out.status);
  return pass("Connected.", { httpStatus: out.status });
}
