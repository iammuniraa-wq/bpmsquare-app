"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";
import { useFeel } from "@/components/FeelProvider";

/** Creates the Standard Quote from the estimate and opens it. */
export default function CreateQuoteButton({ estimateId, variant = "primary", size }: { estimateId: string; variant?: "primary" | "secondary"; size?: "sm" | "md" }) {
  const router = useRouter();
  const { toast, confirm } = useFeel();
  const [busy, setBusy] = useState(false);

  async function go() {
    const ok = await confirm({
      title: "Create the quote?",
      body: "The estimate is locked once it has a quote: its inputs, lines and margin can no longer change. The customer sees one price per group, never your unit costs.",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/estimates/${estimateId}/quote`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.quoteId) {
        toast({ text: `Quote ${json.ref} created`, tone: "success" });
        router.push(ROUTES.standardQuote(json.quoteId));
        return;
      }
      if (res.status === 409 && json.quoteId) { router.push(ROUTES.standardQuote(json.quoteId)); return; }
      toast({ text: json.error ?? "Could not create the quote.", tone: "error" });
    } catch {
      toast({ text: "Network error. Try again.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return <Button variant={variant} size={size} loading={busy} onClick={go}>Create quote</Button>;
}
