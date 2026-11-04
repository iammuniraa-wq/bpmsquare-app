import { listAccountsLive } from "@/lib/data/live";
import { getUserRole } from "@/lib/tenant";
import NewContactForm from "./NewContactForm";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string; email?: string }>;
}) {
  const { account_id, email } = await searchParams;
  const [accountData, role] = await Promise.all([listAccountsLive(), getUserRole()]);
  const accounts = accountData.map(({ account }) => account);
  return <NewContactForm accounts={accounts} defaultAccountId={account_id ?? ""} defaultEmail={email && email.length < 255 ? email : ""} isAdmin={role === "admin"} />;
}
