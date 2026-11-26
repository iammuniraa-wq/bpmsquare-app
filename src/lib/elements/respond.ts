import { NextResponse } from "next/server";
import type { Failure } from "./server";

/** A failed Result as the route's answer: the message, any extra facts (`locked`, `needsDatabaseUpdate`, `used_by`...), and its status. */
export const failed = (f: Failure) => NextResponse.json({ error: f.error, ...(f.extra ?? {}) }, { status: f.status });

/** The plain 404 of a workspace that has not got the add-on: it cannot tell the routes exist. */
export const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** A body that must be a JSON object, else null. */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
