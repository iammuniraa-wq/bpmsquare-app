import { listAccountsLive } from "@/lib/data/live";
import NewContactForm from "./NewContactForm";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string }>;
}) {
  const { account_id } = await searchParams;
  const accountData = await listAccountsLive();
  const accounts = accountData.map(({ account }) => account);
  return <NewContactForm accounts={accounts} defaultAccountId={account_id ?? ""} />;
}
