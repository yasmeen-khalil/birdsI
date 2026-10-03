"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { DEFAULT_AUTO_APPROVE_PREFIXES, type ActionRequest, type AgentPolicy, type Question } from "@birdsi/shared";
import { answerQuestionAction, decideActionAction, dismissQuestionAction, updatePolicyAction } from "@/lib/actions";
import { ButtonArc } from "../Arc";
import { Toast } from "../Toast";
import { TwoStepButton } from "../TwoStep";
import { safeUrl } from "../format";
import { icon14 } from "../icon";

const ASKED_BY: Record<ActionRequest["requestedBy"], string> = { agent: "your coding agent", birdsi: "birdsI", owner: "you" };

export function costText(a: Pick<ActionRequest, "estimatedMonthlyUsd" | "estimatedOnceUsd">): string {
  const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  const parts: string[] = [];
  if (a.estimatedMonthlyUsd !== null) parts.push(a.estimatedMonthlyUsd === 0 ? "No monthly cost" : `${money(a.estimatedMonthlyUsd)} a month`);
  if (a.estimatedOnceUsd !== null) parts.push(a.estimatedOnceUsd === 0 ? "no one-off cost" : `${money(a.estimatedOnceUsd)} once`);
  if (parts.length === 0) return "Cost not known";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One open question: pick an option or write an answer. Dismiss is quiet, on the left. */
export function QuestionCard({ question, repoId }: { question: Question; repoId: string }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"save" | "dismiss" | null>(null);
  const answer = typed.trim() || chosen || "";
  const lookup = safeUrl(question.lookupUrl);
  const inputId = `q-${question.id}`;

  const act = (kind: "save" | "dismiss") =>
    start(async () => {
      setError(null);
      setBusy(kind);
      const r = kind === "save" ? await answerQuestionAction(question.id, repoId, answer) : await dismissQuestionAction(question.id, repoId);
      setBusy(null);
      if (!r.ok) setError(r.message);
      else router.refresh();
    });

  return (
    <form
      className="panel flex flex-col gap-3.5"
      style={{ padding: "22px 24px" }}
      aria-labelledby={`${inputId}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        if (answer) act("save");
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {question.vendorName && <span className="tag">{question.vendorName}</span>}
        <span className="t-small c3">{question.askedBy === "agent" ? "Asked by your coding agent" : "Asked by birdsI"}</span>
      </div>
      <h3 id={`${inputId}-title`} className="t-h3">
        {question.question}
      </h3>
      <p className="t-small c2">{question.why}</p>
      {lookup && (
        <a href={lookup} target="_blank" rel="noreferrer" className="t-small c2 inline-flex items-center gap-1.5 self-start">
          Where to find it
          <ExternalLink {...icon14} />
        </a>
      )}
      {question.options.length > 0 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Choose an answer">
          {question.options.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={chosen === o && !typed.trim()}
              className={`chip${chosen === o && !typed.trim() ? " on" : ""}`}
              onClick={() => {
                setChosen(o);
                setTyped("");
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <label htmlFor={inputId} className="t-small c2" style={{ fontWeight: 500 }}>
          {question.options.length > 0 ? "Or write your own answer" : "Your answer"}
        </label>
        <input id={inputId} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={2000} autoComplete="off" disabled={pending} />
      </div>
      {error && (
        <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn btn-muted" style={{ minHeight: 36 }} disabled={pending} onClick={() => act("dismiss")}>
          {busy === "dismiss" && <ButtonArc />}
          Dismiss
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !answer}>
          {busy === "save" && <ButtonArc />}
          Save answer
        </button>
      </div>
    </form>
  );
}

/** One pending request. Deny is quiet, on the left; Approve is the easy reach, and asks once more. */
export function ActionCard({ action, repoId }: { action: ActionRequest; repoId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [denying, start] = useTransition();

  const deny = () =>
    start(async () => {
      setError(null);
      const r = await decideActionAction(action.id, repoId, "deny");
      if (!r.ok) setError(r.message);
      else router.refresh();
    });

  return (
    <article className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px" }} aria-labelledby={`a-${action.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {action.vendorName && <span className="tag">{action.vendorName}</span>}
        <span className="t-small c3">Asked by {ASKED_BY[action.requestedBy]}</span>
      </div>
      <h3 id={`a-${action.id}`} className="t-h3">
        {action.title}
      </h3>
      <p className="t-small c2">{action.reason}</p>
      <div className="code" style={{ padding: "10px 14px" }}>
        <code className="t-mono block overflow-x-auto whitespace-pre" style={{ color: "var(--text)" }}>
          {action.command}
        </code>
      </div>
      <p className="t-small">
        <span className="c3">Cost: </span>
        {costText(action)}
      </p>
      {error && (
        <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      <div className={`flex gap-3 ${armed ? "flex-col items-stretch" : "items-center justify-between"}`}>
        {!armed && (
          <button type="button" className="btn btn-muted" style={{ minHeight: 36 }} disabled={denying} onClick={deny}>
            {denying && <ButtonArc />}
            Deny
          </button>
        )}
        <TwoStepButton
          label="Approve"
          restClassName="btn btn-primary btn-sm"
          confirmClassName="btn btn-primary btn-sm"
          danger={false}
          prompt="Approve this command?"
          detail={
            <>
              It runs on your own computer the next time you type <span className="t-mono">birdsi approvals run</span>. Nothing runs on birdsI&apos;s servers.
            </>
          }
          confirmLabel="Approve"
          cancelLabel="Not yet"
          onArmedChange={setArmed}
          onConfirm={async () => {
            const r = await decideActionAction(action.id, repoId, "approve");
            return r.ok ? { ok: true } : { ok: false, message: r.message };
          }}
          onDone={() => router.refresh()}
        />
      </div>
    </article>
  );
}

/** What agents may do in this repository. */
export function PolicyControls({ repoId, policy }: { repoId: string; policy: AgentPolicy }) {
  const router = useRouter();
  const [allow, setAllow] = useState(policy.allowPropose);
  const [limit, setLimit] = useState(policy.autoApproveUnderUsd === null ? "" : String(policy.autoApproveUnderUsd));
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const saved = policy.autoApproveUnderUsd === null ? "" : String(policy.autoApproveUnderUsd);
  const parsed = limit.trim() === "" ? null : Number(limit);
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);

  const toggle = () =>
    start(async () => {
      const next = !allow;
      setAllow(next);
      const r = await updatePolicyAction(repoId, { allowPropose: next });
      if (!r.ok) {
        setAllow(!next);
        setNotice({ tone: "error", text: r.message });
      } else router.refresh();
    });

  const saveLimit = () =>
    start(async () => {
      if (invalid) return;
      const r = await updatePolicyAction(repoId, { autoApproveUnderUsd: parsed });
      if (!r.ok) setNotice({ tone: "error", text: r.message });
      else {
        setNotice({ tone: "ok", text: parsed === null ? "Saved. birdsI always asks you first." : `Saved. Commands at or under $${parsed} a month are approved without asking.` });
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4" style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
        <span className="flex flex-col gap-0.5">
          <span id="allow-label" className="t-body">
            Agents may ask questions and propose commands
          </span>
          <span className="t-small c3">When off, agents can still read what birdsI knows, but cannot add to Questions or Approvals.</span>
        </span>
        <span className="inline-flex items-center justify-center" style={{ minWidth: 44, minHeight: 44 }}>
          <button type="button" className="switch" role="switch" aria-checked={allow} aria-labelledby="allow-label" disabled={pending} onClick={toggle} />
        </span>
      </div>
      <form
        className="flex flex-col gap-3"
        style={{ padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
        onSubmit={(e) => {
          e.preventDefault();
          saveLimit();
        }}
      >
        <div className="field">
          <label htmlFor="auto-limit" className="t-body" style={{ fontWeight: 400 }}>
            Approve automatically when the monthly cost is at or under
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative inline-flex items-center" style={{ width: 160 }}>
              <span className="c3 t-body" style={{ position: "absolute", left: 14, pointerEvents: "none" }} aria-hidden="true">
                $
              </span>
              <input id="auto-limit" className={`input${invalid ? " err" : ""}`} inputMode="decimal" placeholder="Always ask" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ paddingLeft: 28 }} aria-describedby="auto-limit-hint" disabled={pending} />
            </span>
            <span className="t-small c2">US dollars a month</span>
            <button type="submit" className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} disabled={pending || invalid || limit.trim() === saved}>
              {pending && <ButtonArc />}
              Save
            </button>
          </div>
          <span id="auto-limit-hint" className="t-small c3">
            {invalid ? "Write a number, like 5, or leave it empty to always ask." : "Leave it empty and every command waits for you."}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="t-small c2">Only commands starting with:</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {(policy.autoApprovePrefixes.length > 0 ? policy.autoApprovePrefixes : DEFAULT_AUTO_APPROVE_PREFIXES).map((p) => (
              <li key={p}>
                <code className="cite">{p}</code>
              </li>
            ))}
          </ul>
        </div>
      </form>
      {notice && (
        <Toast tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Toast>
      )}
    </div>
  );
}
