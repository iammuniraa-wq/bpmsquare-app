import "server-only";
import { NextResponse } from "next/server";
import type { Failure } from "./server";

/** A Failure as a JSON answer: `{ error, ...extra }` with its status. */
export const failResponse = (f: Failure): NextResponse => NextResponse.json({ error: f.error, ...(f.extra ?? {}) }, { status: f.status });

/** The body of a JSON request, or null when it is missing or not an object. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
