import { listAccountsLive } from "@/lib/data/live";
import { getUserRole } from "@/lib/tenant";
import NewContactForm from "./NewContactForm";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string }>;
}) {
  const { account_id } = await searchParams;
  const [accountData, role] = await Promise.all([listAccountsLive(), getUserRole()]);
  const accounts = accountData.map(({ account }) => account);
  return <NewContactForm accounts={accounts} defaultAccountId={account_id ?? ""} isAdmin={role === "admin"} />;
}
