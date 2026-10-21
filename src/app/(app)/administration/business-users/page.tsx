import { redirect } from "next/navigation";
import { peopleRedirect } from "@/app/(app)/settings/people/logic";

// Administration > Business users is now Settings > People; the address stays so saved links keep working.
export default async function BusinessUsersRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(peopleRedirect(undefined, await searchParams));
}
