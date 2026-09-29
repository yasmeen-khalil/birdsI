import type { Metadata } from "next";
import { chatHistory, findingsForScan, toFinding } from "@birdsi/db";
import { ChatPanel } from "@/components/ChatPanel";
import { latestDone, repoContext } from "@/components/server/data";

export const metadata: Metadata = { title: "Ask birdsI" };

export default async function ChatPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const [latest, history] = await Promise.all([latestDone(repo.id), chatHistory(repo.id, user.id)]);
  const findings = latest ? (await findingsForScan(latest.id)).map(toFinding) : [];
  return (
    <main className="mx-auto flex w-full flex-col" style={{ maxWidth: 820, background: "var(--surface)", borderLeft: "1px solid var(--line)", borderRight: "1px solid var(--line)" }}>
      <h1 className="sr-only">Ask birdsI</h1>
      <ChatPanel
        variant="page"
        data={{
          repoId: repo.id,
          fullName: repo.full_name,
          branch: repo.default_branch,
          initialMessages: history,
          findings: Object.fromEntries(findings.map((f) => [f.id, { title: f.title, severity: f.severity }])),
          scan: latest ? { kind: latest.kind, finishedAt: latest.finishedAt } : null,
        }}
      />
    </main>
  );
}
