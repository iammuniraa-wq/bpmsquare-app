import { redirect } from "next/navigation";
import { peopleRedirect } from "@/app/(app)/settings/people/logic";

// Administration > Business roles is now the Roles tab of Settings > People; the address stays so saved links keep working.
export default async function BusinessRolesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(peopleRedirect("roles", await searchParams));
}
