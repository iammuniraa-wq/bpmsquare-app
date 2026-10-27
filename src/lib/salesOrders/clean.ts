import { isCurrencyCode } from "@/lib/currency";
import type { OrderParty } from "./types";

// Request-body cleaning for the sales order routes: every free-text field is trimmed and capped, nothing is
// stored as typed by the client without a limit, and a malformed value becomes null rather than an error.

export function cleanText(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** A bill-to / ship-to block. A party without a name is treated as "not given" (null). */
export function cleanParty(v: unknown): OrderParty | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const name = cleanText(r.name, 200);
  if (!name) return null;
  return {
    name,
    address: cleanText(r.address, 500),
    contact: cleanText(r.contact, 200),
    phone: cleanText(r.phone, 50),
    email: cleanText(r.email, 200),
    tax_id: cleanText(r.tax_id, 50),
  };
}

export const cleanCurrency = (v: unknown): string | null => (isCurrencyCode(v) ? v : null);

export type ListParams = {
  status: string | null;
  account_id: string | null;
  /** Orders made from one quote, deal or order: the quote page's "order SO-0007" fact. */
  source_id: string | null;
  q: string | null;
  page: number;
  page_size: number;
  sort: "created_at" | "ref" | "total" | "expected_date" | "status";
  dir: "asc" | "desc";
};

const SORTS = ["created_at", "ref", "total", "expected_date", "status"] as const;

export function parseListParams(sp: URLSearchParams): ListParams {
  const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  const size = Math.floor(Number(sp.get("page_size")));
  const sort = sp.get("sort") as ListParams["sort"] | null;
  return {
    status: cleanText(sp.get("status"), 20),
    account_id: cleanText(sp.get("account_id"), 64),
    source_id: cleanText(sp.get("source_id"), 64),
    q: cleanText(sp.get("q"), 100),
    page,
    page_size: Number.isFinite(size) && size > 0 ? Math.min(100, size) : 25,
    sort: sort && (SORTS as readonly string[]).includes(sort) ? sort : "created_at",
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
  };
}

/** Strips characters with special meaning in PostgREST's .or() filter DSL so a search term cannot break out of its ILIKE clause. */
export const searchTerm = (q: string): string => q.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
