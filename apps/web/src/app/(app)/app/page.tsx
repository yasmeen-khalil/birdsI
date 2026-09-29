import { redirect } from "next/navigation";
import { appUser, userRepos } from "@/components/server/data";

/** Opens the first connected repository, or the connect step when there is none. */
export default async function AppIndex() {
  const user = await appUser();
  const repos = await userRepos(user.id);
  const first = repos[0];
  redirect(first ? `/app/${first.id}` : "/connect");
}
