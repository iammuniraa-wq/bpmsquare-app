import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Nova Market Signals -- real, live web search about an account's company
 * (owner request 2026-08-25, explicitly chosen over internal-only CRM
 * signals: recent news, funding, leadership changes, expansions). Mirrors
 * the error-handling pattern already proven in standardQuoteAI.ts/
 * import/extract.ts (same model, same most-specific-error-first mapping),
 * but uses the server-side web_search tool instead of a forced custom
 * tool -- Claude decides how many times to search, then replies with the
 * final structured answer as JSON text (a tool_choice-forced call would
 * stop it from searching at all).
 *
 * Deliberately NOT auto-run for every account on every page load: a real,
 * billed multi-search Claude call per account is too expensive/slow for
 * that. This is only ever invoked on an explicit user action (the account
 * page's "Get market signals" button), and the API route + client cache
 * around it keep it that way -- see api/nova/market-intel/route.ts and
 * lib/nova/marketIntelClient.ts.
 */

export class MarketIntelError extends Error {}

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new MarketIntelError("Market signals aren't configured yet (missing ANTHROPIC_API_KEY).");
  }
  return new Anthropic();
}

export type MarketSignal = { headline: string; detail: string; tone: "positive" | "neutral" | "risk" };
export type MarketSource = { title: string; url: string };
export type MarketIntelResult = {
  summary: string;
  signals: MarketSignal[];
  sources: MarketSource[];
  fetchedAt: string;
};

function buildPrompt(accountName: string, accountMeta: string): string {
  return `You are researching "${accountName}"${accountMeta ? ` (${accountMeta})` : ""} for a B2B sales rep who is about to talk to this company. Use web search to find recent, REAL, verifiable public information: news, funding rounds, leadership changes, expansions, financial trouble, industry trends affecting them. This account may be a small or mid-size business with little to no press coverage -- that is a normal, common outcome, not a failure.

Do not invent, guess, or pad with generic industry commentary presented as if it were about this specific company. If you find nothing substantive and specific to this company, say so plainly in the summary and return an empty signals array.

When you are done searching, reply with ONLY a single JSON object -- no markdown code fences, no commentary before or after -- in exactly this shape:
{"summary": "2-3 sentence plain-English summary a rep can skim in 10 seconds before a call", "signals": [{"headline": "short label, under 8 words", "detail": "one sentence, specific to this company", "tone": "positive|neutral|risk"}], "sources": [{"title": "source title", "url": "source url"}]}

"signals" should have 0-5 items, most relevant/recent first. "tone" is "positive" for good news (funding, growth, awards), "risk" for bad news (layoffs, financial trouble, leadership departure), "neutral" for factual/informational items. Only include a source you actually found via search -- never fabricate a URL.`;
}

export async function fetchAccountMarketIntel(accountName: string, accountMeta = ""): Promise<MarketIntelResult> {
  let response;
  try {
    response = await client().messages.create({
      model: "claude-opus-5",
      // Generous headroom: intermediate web_search result content shares
      // this same output budget with the final answer, so a well-covered
      // company can burn through a tight budget before Claude gets to write
      // the closing JSON (2026-08-26: reported as "sometimes it shows,
      // sometimes it fails" -- 4000 was too tight for that case).
      max_tokens: 8000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: buildPrompt(accountName, accountMeta) }],
    });
  } catch (e) {
    console.error("Market intel request failed:", e);
    if (e instanceof Anthropic.AuthenticationError) {
      throw new MarketIntelError("The AI service rejected ANTHROPIC_API_KEY. Check it's set correctly and redeploy.");
    }
    if (e instanceof Anthropic.PermissionDeniedError) {
      throw new MarketIntelError("This API key doesn't have access to web search.");
    }
    if (e instanceof Anthropic.NotFoundError) {
      throw new MarketIntelError("The AI model isn't available for this account.");
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new MarketIntelError("The AI service is rate-limited right now. Try again in a moment.");
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new MarketIntelError("Could not reach the AI service. Try again in a moment.");
    }
    if (e instanceof Anthropic.APIError) {
      throw new MarketIntelError(`AI service error (${e.status}): ${e.message}`);
    }
    throw new MarketIntelError("Market signals failed to load. Try again.");
  }

  if (response.stop_reason === "refusal") {
    throw new MarketIntelError("The AI declined this request.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new MarketIntelError("The response was cut off before finishing. Try again.");
  }

  // A failed individual web search surfaces as a content block
  // (web_search_tool_result with an error object), not a thrown exception --
  // Claude works around it and still produces a final text answer, so we
  // only care about the final text here, not every search attempt.
  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!rawText) {
    throw new MarketIntelError("The AI did not return a summary. Try again.");
  }
  // The prompt asks for no markdown fences, but strip one if it shows up
  // anyway -- cheap insurance against an otherwise-valid response failing
  // to parse over a formatting quirk.
  const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new MarketIntelError("The AI's response wasn't in the expected format. Try again.");
  }

  let parsed: { summary?: unknown; signals?: unknown; sources?: unknown };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new MarketIntelError("The AI's response wasn't valid JSON. Try again.");
  }

  const signals: MarketSignal[] = Array.isArray(parsed.signals)
    ? parsed.signals
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as Record<string, unknown>).headline === "string")
        .map((s): MarketSignal => ({
          headline: String(s.headline),
          detail: typeof s.detail === "string" ? s.detail : "",
          tone: s.tone === "positive" ? "positive" : s.tone === "risk" ? "risk" : "neutral",
        }))
        .slice(0, 5)
    : [];

  const sources: MarketSource[] = Array.isArray(parsed.sources)
    ? parsed.sources
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as Record<string, unknown>).url === "string")
        .map((s) => ({ title: typeof s.title === "string" ? s.title : s.url as string, url: String(s.url) }))
        .slice(0, 8)
    : [];

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "No summary available.",
    signals,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}
