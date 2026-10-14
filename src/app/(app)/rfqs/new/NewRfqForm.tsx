"use client";

import { useRouter } from "next/navigation";
import RfqComposer from "@/components/rfq/RfqComposer";

export default function NewRfqForm() {
  const router = useRouter();
  return <RfqComposer onCreated={(r) => router.push(`/rfqs/${r.id}`)} onCancel={() => router.push("/rfqs")} />;
}
