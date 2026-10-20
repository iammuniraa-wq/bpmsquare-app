"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { CapabilityView, StepId, StudyBundle } from "@/lib/studio/types";

// Thin fetch helper for the studio screens: one place that turns a route's
// { error, confirm_required } answer into something a button can act on.

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; confirm?: boolean; code?: string };

export async function studioApi<T = Record<string, unknown>>(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false, status: res.status,
        error: typeof json.error === "string" ? json.error : "Something went wrong. Try again.",
        confirm: json.confirm_required === true,
        code: typeof json.code === "string" ? json.code : undefined,
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Check your connection and try again." };
  }
}

export const STUDIO_BASE = "/api/process-studio";

/** What every step component receives. */
export type StepProps = {
  bundle: StudyBundle;
  canEdit: boolean;
  caps: Record<string, CapabilityView>;
  toast: (message: string) => void;
  refresh: () => void;
  openCap: (id: string) => void;
};

// ── The four AI steps, and the one thing that runs them ──────────────────────

export type RunKind = "map" | "fit" | "changes" | "plan";

const RUN: Record<RunKind, { path: string; busy: string; next: StepId; confirmable: boolean }> = {
  map: { path: "map", busy: "Drafting your process map from the conversation…", next: "process", confirmable: true },
  fit: { path: "fit", busy: "Checking each step against what BPMSquare has. This can take a minute…", next: "fit", confirmable: false },
  changes: { path: "changes", busy: "Working out what would change…", next: "changes", confirmable: false },
  plan: { path: "plan", busy: "Building the plan…", next: "plan", confirmable: true },
};

/** Where a finished run takes the client: map -> process, fit -> fit, changes -> changes, plan -> plan. */
export const stepUrl = (studyId: string, step: StepId): string => `/process-studio/${studyId}?step=${step}`;

/**
 * Runs one AI step. A route that would replace work the client has edited
 * answers 409 { confirm_required }; the client is asked in plain words and the
 * call is repeated with { confirm: true }. Everything after is a refresh or a
 * navigation, so the screen always shows what is stored.
 */
export function useStepRunner(studyId: string, onError: (message: string) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState<RunKind | null>(null);

  const run = useCallback(async (kind: RunKind): Promise<boolean> => {
    const spec = RUN[kind];
    setBusy(kind);
    try {
      const url = `${STUDIO_BASE}/${studyId}/${spec.path}`;
      let res = await studioApi("POST", url, {});
      if (!res.ok && res.confirm && spec.confirmable) {
        if (!window.confirm(res.error)) return false;
        res = await studioApi("POST", url, { confirm: true });
      }
      if (!res.ok) { onError(res.error); return false; }
      router.push(stepUrl(studyId, spec.next));
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }, [studyId, router, onError]);

  return { run, busy, busyMessage: busy ? RUN[busy].busy : null };
}
