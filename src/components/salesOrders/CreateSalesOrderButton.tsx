"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";
import { createOrderFromSource } from "@/lib/salesOrders/client";

/**
 * "Create sales order" on an accepted quote or a won quotation. One tap: the server copies the lines, prices, tax,
 * currency, customer and pricing mode from the source, then this opens the new order. If an order already exists for
 * the source (another tab, a colleague) the server says so and this asks before making another.
 */
export default function CreateSalesOrderButton({ sourceType, sourceId, variant = "secondary" }: {
  sourceType: "standard_quote" | "quotation" | "opportunity";
  sourceId: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const { confirm, toast } = useFeel();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    let res = await createOrderFromSource({ type: sourceType, id: sourceId });
    if (!res.ok && res.needsConfirmation) {
      if (!(await confirm({ title: "Another sales order?", body: `${res.error.split(" Send confirm_another")[0]} Make another one?`, confirmLabel: "Make another" }))) { setBusy(false); return; }
      res = await createOrderFromSource({ type: sourceType, id: sourceId }, true);
    }
    setBusy(false);
    if (!res.ok) { toast({ text: res.error, tone: "error" }); return; }
    router.push(ROUTES.salesOrder(res.data.id));
  }

  return <Button variant={variant} loading={busy} onClick={() => void create()} data-guide="quote.create_sales_order">Create sales order</Button>;
}
