"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import RfqComposer from "@/components/rfq/RfqComposer";
import { RfqSendOutcome } from "@/components/rfq/RfqSendNotices";
import type { RfqCreated } from "@/components/rfq/submitRfq";
import { sendOutcome } from "@/lib/rfq/sendOutcome";

export default function NewRfqForm() {
  const router = useRouter();
  // Created, but the send did not reach everyone: say so here instead of landing on the RFQ as if it had gone out.
  const [unsent, setUnsent] = useState<RfqCreated | null>(null);
  const outcome = unsent ? sendOutcome(unsent.ref, unsent.sent, true) : null;
  if (unsent && outcome) return <RfqSendOutcome rfq={unsent} outcome={outcome} />;
  return (
    <RfqComposer
      onCreated={(r) => {
        if (sendOutcome(r.ref, r.sent, r.sendRequested === true)) setUnsent(r);
        else router.push(`/rfqs/${r.id}`);
      }}
      onCancel={() => router.push("/rfqs")}
    />
  );
}
