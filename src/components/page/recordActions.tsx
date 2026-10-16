"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Button, { type ButtonVariant } from "@/components/ui/Button";
import { useFeel, type ConfirmOptions } from "@/components/FeelProvider";

/**
 * A record action described as data, so a server page can hand it to a client
 * button or to the "..." menu without passing a function across the boundary:
 * call an endpoint, then refresh the page (or go somewhere). Failure shows the
 * route's own error text in a toast, as the old per-object panels did inline.
 */
export type RecordAction = {
  label: string;
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  /** Asks first. */
  confirm?: ConfirmOptions;
  danger?: boolean;
  hidden?: boolean;
  /** Success toast; `{key}` is replaced by that key of the response JSON. */
  successText?: string;
  /** Go here on success instead of refreshing in place; `{id}` comes from the response JSON. */
  redirectTo?: string;
  /** Shown when the route gives no error of its own. */
  errorText?: string;
};

export function useRecordActionRunner() {
  const router = useRouter();
  const { confirm, toast } = useFeel();
  return useCallback(async (a: RecordAction) => {
    if (a.confirm && !(await confirm(a.confirm))) return;
    let res: Response;
    try {
      res = await fetch(a.endpoint, {
        method: a.method ?? "PATCH",
        headers: a.body ? { "Content-Type": "application/json" } : undefined,
        body: a.body ? JSON.stringify(a.body) : undefined,
      });
    } catch {
      toast({ text: a.errorText ?? "Network error", tone: "error" });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      toast({ text: (json.error as string | undefined) ?? a.errorText ?? "That did not work", tone: "error" });
      return;
    }
    const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(json[k] ?? ""));
    if (a.successText) toast({ text: fill(a.successText), tone: "success" });
    if (a.redirectTo) router.push(fill(a.redirectTo));
    else router.refresh();
  }, [router, confirm, toast]);
}

/** A header button that runs one RecordAction (the record's single primary step). */
export default function RecordActionButton({
  action, variant = "primary", size,
}: {
  action: RecordAction;
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  const run = useRecordActionRunner();
  const [busy, setBusy] = useState(false);
  if (action.hidden) return null;
  return (
    <Button
      variant={variant}
      size={size}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try { await run(action); } finally { setBusy(false); }
      }}
    >
      {action.label}
    </Button>
  );
}
