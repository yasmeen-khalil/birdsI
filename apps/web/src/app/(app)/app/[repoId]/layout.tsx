import type { ReactNode } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { repoContext, toOption, userRepos } from "@/components/server/data";

export default async function RepoLayout({ children, params }: { children: ReactNode; params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const repos = await userRepos(user.id);
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar login={user.github_login ?? user.email} repos={repos.map(toOption)} current={toOption(repo)} />
      {children}
    </div>
  );
}
