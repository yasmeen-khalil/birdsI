import type { ReactNode } from "react";
import { chatHistory, findingsForScan, toFinding } from "@birdsi/db";
import { ChatDock } from "@/components/shell/ChatDock";
import { TopBar } from "@/components/shell/TopBar";
import { latestDone, repoContext, toOption, userRepos } from "@/components/server/data";

export default async function RepoLayout({ children, params }: { children: ReactNode; params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const [repos, latest, history] = await Promise.all([userRepos(user.id), latestDone(repo.id), chatHistory(repo.id, user.id)]);
  const findings = latest ? (await findingsForScan(latest.id)).map(toFinding) : [];
  const findingIndex = Object.fromEntries(findings.map((f) => [f.id, { title: f.title, severity: f.severity }]));
  const current = toOption(repo);
  return (
    <ChatDock
      repoId={repo.id}
      topbar={<TopBar login={user.github_login ?? user.email} repos={repos.map(toOption)} current={current} />}
      chat={{
        repoId: repo.id,
        fullName: repo.full_name,
        branch: repo.default_branch,
        initialMessages: history,
        findings: findingIndex,
        scan: latest ? { kind: latest.kind, finishedAt: latest.finishedAt } : null,
      }}
    >
      {children}
    </ChatDock>
  );
}
