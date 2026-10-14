import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import NewRfqForm from "./NewRfqForm";

export default async function NewRfqPage() {
  await requireWorkcenterView("rfqs");
  await requireFeature("rfq");
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.rfqs} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>← All RFQs</Link>
      </div>
      <PageHeader title="New RFQ" subtitle="Ask suppliers for a price on items you can't price yet. Each supplier gets their own email, reply link and reply sheet." />
      <div style={{ ...cardStyle, maxWidth: 920 }}>
        <NewRfqForm />
      </div>
    </>
  );
}
