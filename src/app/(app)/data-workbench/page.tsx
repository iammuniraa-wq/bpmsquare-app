import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { getTenant } from "@/lib/tenant";

export default async function DataWorkbenchPage() {
  const tenant = await getTenant();
  const customFieldsByObject = tenant?.config?.custom_fields ?? {};

  return (
    <>
      <TabTitle title="Data Workbench" />
      <PageHeader
        title="Data Workbench"
        subtitle="Import accounts, contacts, assets and users from CSV / Excel — download a template, fill it in, upload and review before committing"
      />
      <DataWorkbenchClient customFieldsByObject={customFieldsByObject} />
    </>
  );
}
