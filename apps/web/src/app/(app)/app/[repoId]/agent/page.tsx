import type { Metadata } from "next";
import type { ActionRequest } from "@birdsi/shared";
import { CopyButton } from "@/components/CopyButton";
import { Frame } from "@/components/Frame";
import { LocalTime } from "@/components/LocalTime";
import { plural } from "@/components/format";
import { ActionCard, costText, PolicyControls, QuestionCard } from "@/components/ops/AgentControls";
import { repoContext } from "@/components/server/data";
import { loadActions, loadQuestions } from "@/lib/ops";

export const metadata: Metadata = { title: "Agent" };

const STATUS_TAG: Record<Exclude<ActionRequest["status"], "pending">, { cls: string; text: string }> = {
  approved: { cls: "tag run", text: "Approved, waiting to run" },
  executed: { cls: "tag ok", text: "Ran" },
  failed: { cls: "tag bad", text: "Failed" },
  denied: { cls: "tag", text: "Denied" },
  expired: { cls: "tag", text: "Expired" },
};

const MCP_ADD = "claude mcp add birdsi -- npx -y birdsi mcp";
const MCP_SERVER = "npx birdsi mcp";

function SectionHead({ id, title, intro, count }: { id: string; title: string; intro: string; count?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 id={id} className="t-h2 max-[900px]:text-[24px]!">
        {title}
        {count ? <span className="c3 t-body" style={{ fontFamily: "var(--sans)", marginLeft: 10 }}>{count} open</span> : null}
      </h2>
      <p className="t-body c2" style={{ maxWidth: 720 }}>
        {intro}
      </p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="t-small c2" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      {children}
    </p>
  );
}

export default async function AgentPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const [questions, { actions, policy }] = await Promise.all([loadQuestions(repo.id, user), loadActions(repo.id, user)]);
  const open = questions.filter((q) => q.status === "open");
  const answered = questions.filter((q) => q.status === "answered").sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""));
  const pending = actions.filter((a) => a.status === "pending");
  const history = actions.filter((a) => a.status !== "pending").sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));

  return (
    <main className="flex flex-col gap-16 px-16 pt-12 pb-16 max-[900px]:gap-12 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      <div className="flex flex-col gap-2.5" style={{ maxWidth: 760 }}>
        <h1 className="t-h1">Agent</h1>
        <p className="t-body c2">
          Where birdsI and your coding agent come to you: questions only you can answer, and actions that need your yes before anything runs.
          {open.length + pending.length > 0 ? ` ${plural(open.length + pending.length, "thing")} waiting for you.` : ""}
        </p>
      </div>

      <section className="flex flex-col gap-5" aria-labelledby="questions-title">
        <SectionHead id="questions-title" title="Questions for you" intro="Plans, budgets and choices birdsI cannot read from the code. Each answer goes straight into what birdsI knows." count={open.length} />
        {open.length === 0 ? (
          <Empty>Nothing to answer. birdsI asks here when it cannot know something itself.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[1200px]:grid-cols-2">
            {open.map((q) => (
              <QuestionCard key={q.id} question={q} repoId={repo.id} />
            ))}
          </div>
        )}
        {answered.length > 0 && (
          <details className="disclose">
            <summary className="t-small c2">Answered ({answered.length})</summary>
            <div className="flex flex-col" style={{ marginTop: 10 }}>
              {answered.map((q) => (
                <div key={q.id} className="grid grid-cols-1 gap-x-6 gap-y-1 min-[901px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px]" style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                  <span className="t-small c2">{q.question}</span>
                  <span className="t-small" style={{ fontWeight: 600 }}>
                    {q.answer}
                  </span>
                  <span className="t-small c3 min-[901px]:text-right">
                    <LocalTime iso={q.answeredAt} style="list" />
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="approvals-title">
        <SectionHead id="approvals-title" title="Approvals" intro="Commands your coding agent or birdsI wants to run, like upgrading a plan. Nothing runs until you approve it." count={pending.length} />
        {pending.length === 0 ? (
          <Empty>Nothing waiting for approval. When an agent proposes a command, it waits here for your yes.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[1200px]:grid-cols-2">
            {pending.map((a) => (
              <ActionCard key={a.id} action={a} repoId={repo.id} />
            ))}
          </div>
        )}
        {history.length > 0 && (
          <div className="flex flex-col">
            <h3 className="t-label c2" style={{ paddingBottom: 10 }}>
              History
            </h3>
            {history.map((a, i) => {
              const tag = STATUS_TAG[a.status as Exclude<ActionRequest["status"], "pending">];
              return (
                <div key={a.id} className="flex flex-col gap-1.5" style={{ padding: "14px 0", borderTop: "1px solid var(--line)", ...(i === history.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}) }}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
                    <span className="t-body truncate" style={{ fontWeight: 600 }}>
                      {a.title}
                    </span>
                    <span className="flex items-center gap-2">
                      {a.autoApproved && <span className="tag">Approved automatically</span>}
                      <span className={tag.cls}>{tag.text}</span>
                    </span>
                  </div>
                  <span className="t-small c3">
                    <span className="t-mono-s">{a.command}</span>
                    <span>
                      {" "}
                      / {costText(a)} / <LocalTime iso={a.decidedAt ?? a.createdAt} style="list" />
                    </span>
                  </span>
                  {a.result && (
                    <details className="disclose">
                      <summary className="t-small c2">Output</summary>
                      <pre className="code t-mono-s m-0 overflow-x-auto whitespace-pre-wrap" style={{ padding: "10px 14px", marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
                        {a.result}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-y-10 min-[901px]:grid-cols-12 min-[901px]:gap-x-6" aria-labelledby="policy-title">
        <div className="flex flex-col gap-5 min-[901px]:col-span-7">
          <SectionHead id="policy-title" title="What agents may do" intro="Agents can always read what birdsI knows about this app. These settings decide what they can ask for." />
          <PolicyControls repoId={repo.id} policy={policy} />
        </div>
        <Frame arm={26} bend={12} className="flex flex-col gap-3.5 self-start px-[30px] py-7 min-[901px]:col-span-4 min-[901px]:col-start-9 max-[900px]:px-[22px] max-[900px]:py-6">
          <h2 className="t-h3">Connect your coding agent</h2>
          <p className="t-small c2">In Claude Code, run this once in your project folder:</p>
          <div className="code flex items-center justify-between gap-2" style={{ padding: "6px 6px 6px 14px" }}>
            <code className="t-mono-s min-w-0 overflow-x-auto whitespace-pre" style={{ color: "var(--text)" }}>
              {MCP_ADD}
            </code>
            <CopyButton text={MCP_ADD} />
          </div>
          <p className="t-small c2">Any other agent that speaks MCP starts the server with:</p>
          <div className="code flex items-center justify-between gap-2" style={{ padding: "6px 6px 6px 14px" }}>
            <code className="t-mono-s min-w-0 overflow-x-auto whitespace-pre" style={{ color: "var(--text)" }}>
              {MCP_SERVER}
            </code>
            <CopyButton text={MCP_SERVER} />
          </div>
          <p className="t-small c3">Your agent can then read the vendors, limits, alerts and your vision, ask you questions here, and propose actions for your approval.</p>
        </Frame>
      </section>
    </main>
  );
}
