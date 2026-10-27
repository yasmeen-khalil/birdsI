import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import type { ChecklistItem } from "@birdsi/shared";
import { safeUrl } from "@/components/format";
import { icon14 } from "@/components/icon";
import { repoContext } from "@/components/server/data";
import { loadChecklist } from "@/lib/checklist";

export const metadata: Metadata = { title: "Set up" };

const STATUS_WORD: Record<ChecklistItem["status"], string> = { done: "Done", todo: "To do", failed: "Not working", blocked: "Waiting", optional: "Optional" };
const STATUS_CLASS: Record<ChecklistItem["status"], string> = { done: "tag ok", todo: "tag", failed: "tag bad", blocked: "tag", optional: "tag" };

function Item({ item, base }: { item: ChecklistItem; base: string }) {
  const open = item.status !== "done";
  return (
    <div className="flex flex-col gap-2.5" style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="t-body inline-flex flex-wrap items-center gap-2" style={{ fontWeight: 600 }}>
            {item.title}
            <span className={STATUS_CLASS[item.status]}>{STATUS_WORD[item.status]}</span>
            {item.required ? null : <span className="t-small c3">optional</span>}
          </span>
          <span className="t-small c2">{item.state}</span>
        </span>
        {item.where && open ? (
          <Link className="btn btn-secondary btn-sm" href={`${base}${item.where}`} style={{ minHeight: 32, fontSize: 13 }}>
            Open {item.where.slice(1)}
          </Link>
        ) : null}
      </div>
      {open && item.steps.length > 0 ? (
        <ol className="flex flex-col gap-1 t-small c2" style={{ paddingLeft: 18, listStyle: "decimal" }}>
          {item.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : null}
      {open && item.willDo ? (
        <p className="t-small c3">
          <span className="c2">Once done:</span> {item.willDo}
        </p>
      ) : null}
      {item.links.length > 0 && open ? (
        <span className="inline-flex flex-wrap items-center gap-3 t-small">
          {item.links.map((l) => {
            const url = safeUrl(l.url);
            return url ? (
              <a key={l.url} className="inline-flex items-center gap-1" href={url} target="_blank" rel="noreferrer">
                {l.label}
                <ExternalLink {...icon14} />
              </a>
            ) : null;
          })}
        </span>
      ) : null}
    </div>
  );
}

export default async function SetupPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const view = await loadChecklist(repo.id, user);
  const base = `/app/${repo.id}`;
  const groups = [...new Set(view.items.map((i) => i.group))];
  return (
    <main className="flex flex-col gap-10 px-16 pt-12 pb-16 max-[900px]:gap-8 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      <section className="flex flex-col gap-2.5" style={{ maxWidth: 760 }}>
        <h1 className="t-h1">Set up {view.appName}</h1>
        <p className="t-body c2">
          {view.complete ? "Everything birdsI needs is connected. The cockpit reads every project every hour." : `${view.required.done} of ${view.required.total} required steps done. birdsI builds the cockpit from what you connect here, and says what each key lets it read before you make one.`}
          {view.optional.total > 0 ? ` ${view.optional.done} of ${view.optional.total} optional steps done.` : ""}
        </p>
        <p className="t-small c3" style={{ maxWidth: 720 }}>
          {view.mayDo}
        </p>
      </section>
      {groups.map((group) => (
        <section key={group} className="flex flex-col" aria-label={group} style={{ maxWidth: 820 }}>
          <div className="ghead">
            <span className="t-label">{group}</span>
            <span className="t-small c3">{view.items.filter((i) => i.group === group && i.status === "done").length} of {view.items.filter((i) => i.group === group).length} done</span>
          </div>
          {view.items
            .filter((i) => i.group === group)
            .map((item) => (
              <Item key={item.id} item={item} base={base} />
            ))}
        </section>
      ))}
      <p className="t-small c3">
        The same list from the terminal: <span className="t-mono-s">npx birdsi setup</span>, and for agents the <span className="t-mono-s">birdsi_setup</span> MCP tool.{" "}
        <Link href={base}>Back to the cockpit</Link>
      </p>
    </main>
  );
}
