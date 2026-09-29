"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, ChevronRight, X } from "lucide-react";
import type { ChatMessage, ScanKind, Severity } from "@birdsi/shared";
import { askAction } from "@/lib/actions";
import { Arc } from "./Arc";
import { ConfidencePill } from "./Confidence";
import { LocalTime } from "./LocalTime";
import { SeverityMeter } from "./Severity";
import { githubFileUrl, KIND_LOWER, plural, repoName } from "./format";
import { icon, icon20 } from "./icon";

export interface ChatPanelData {
  repoId: string;
  fullName: string;
  branch: string;
  initialMessages: ChatMessage[];
  /** Finding id -> what a citation row shows. */
  findings: Record<string, { title: string; severity: Severity }>;
  scan: { kind: ScanKind; finishedAt: string | null } | null;
}

let localCount = 0;

/** The question as it shows before the server stores it. */
function localQuestion(content: string): ChatMessage {
  localCount += 1;
  return { id: `local-${localCount}`, role: "user", content, citations: [], judgment: false, createdAt: new Date().toISOString() };
}

const STARTERS = ["Is it safe to launch this weekend?", "Where is the payment handled?", "Explain the most serious finding simply"];

function Paragraphs({ text, first }: { text: string; first: boolean }) {
  const paras = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <>
      {paras.map((p, i) => (
        <p key={i} className={first && i === 0 ? "t-body" : "t-body c2"} style={{ whiteSpace: "pre-wrap", ...(first && i === 0 ? { fontFamily: "var(--serif)", fontSize: 19, lineHeight: 1.45 } : {}) }}>
          {p}
        </p>
      ))}
    </>
  );
}

function Answer({ m, data }: { m: ChatMessage; data: ChatPanelData }) {
  const findingCites = m.citations.filter((c) => c.findingId);
  const fileCites = m.citations.filter((c) => !c.findingId && c.path);
  const files = new Set(fileCites.map((c) => c.path));
  return (
    <div className="flex flex-col gap-3">
      <Paragraphs text={m.content} first />
      {findingCites.map((c) => {
        const f = c.findingId ? data.findings[c.findingId] : undefined;
        return (
          <Link key={c.findingId} className="fref max-[900px]:grid-cols-[minmax(0,1fr)_auto]!" href={`/app/${data.repoId}/findings/${c.findingId}`}>
            {f ? <SeverityMeter severity={f.severity} className="max-[900px]:hidden!" /> : <span className="max-[900px]:hidden" />}
            <span className="t-small" style={{ fontWeight: 500 }}>
              {f?.title ?? c.label}
            </span>
            <ChevronRight {...icon} className="i c3" />
          </Link>
        );
      })}
      {fileCites.length > 0 && (
        <p className="t-small c2 flex flex-wrap items-center gap-1.5">
          <span>From</span>
          {fileCites.map((c, i) => (
            <a key={`${c.path}:${c.lineStart ?? i}`} className="cite" href={githubFileUrl(data.fullName, data.branch, c.path!, c.lineStart)} target="_blank" rel="noreferrer" title={c.label}>
              {c.path}
              {c.lineStart ? `:${c.lineStart}` : ""}
            </a>
          ))}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {m.judgment && <ConfidencePill confidence="judgment" small />}
        {(findingCites.length > 0 || files.size > 0) && (
          <span className="t-small c3">
            Based on {[findingCites.length > 0 ? plural(findingCites.length, "finding") : "", files.size > 0 ? plural(files.size, "file") : ""].filter(Boolean).join(" and ")}.
          </span>
        )}
      </div>
    </div>
  );
}

/** Questions about one repository, answered from its code and findings. */
export function ChatPanel({ data, onClose, variant = "dock" }: { data: ChatPanelData; onClose?: () => void; variant?: "dock" | "page" }) {
  const [messages, setMessages] = useState<ChatMessage[]>(data.initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const name = repoName(data.fullName);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, pending, error]);

  const send = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    setDraft("");
    const optimistic = localQuestion(q);
    setMessages((prev) => prev.concat(optimistic));
    start(async () => {
      const result = await askAction(data.repoId, q);
      if (result.ok) setMessages((prev) => prev.concat(result.data));
      else {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(q);
        setError(result.message);
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-grow flex-col" style={variant === "page" ? { height: "calc(100dvh - 60px)" } : { height: "100%" }}>
      <div className="flex items-center justify-between gap-3" style={{ padding: "16px 20px 16px 24px", borderBottom: "1px solid var(--line)" }}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="t-h3">Ask birdsI</h2>
          <span className="t-small c3">
            About {name}
            {data.scan ? (
              <>
                , using the {KIND_LOWER[data.scan.kind]} from <LocalTime iso={data.scan.finishedAt} style="sentence" />
              </>
            ) : (
              ". No scan yet, so answers come from the code alone."
            )}
          </span>
        </div>
        {onClose && (
          <button type="button" className="btn btn-quiet btn-sm" aria-label="Close chat" onClick={onClose} style={{ width: 44, height: 44, padding: 0 }}>
            <X {...icon20} />
          </button>
        )}
      </div>

      <div ref={scroller} className="flex min-h-0 flex-grow flex-col gap-[22px] overflow-y-auto" style={{ padding: 24 }} aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="flex flex-col gap-2.5">
            <h3 className="t-h2" style={{ fontSize: 23 }}>
              Ask anything about {name}
            </h3>
            {STARTERS.map((s) => (
              <button key={s} type="button" className="chip" style={{ justifyContent: "flex-start", height: "auto", minHeight: 40, padding: "8px 12px", whiteSpace: "normal", textAlign: "left" }} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="t-body" style={{ alignSelf: "flex-end", maxWidth: "84%", padding: "10px 14px", borderRadius: "10px 10px 2px 10px", background: "var(--raised)", whiteSpace: "pre-wrap" }}>
              {m.content}
            </div>
          ) : (
            <Answer key={m.id} m={m} data={data} />
          ),
        )}
        {pending && (
          <div className="t-small flex items-center gap-2" role="status">
            <Arc size={14} />
            <span className="c2">Reading your code and its findings</span>
          </div>
        )}
        {error && (
          <div className="panel flex flex-col gap-2.5" style={{ padding: "18px 20px" }} role="alert">
            <h3 className="t-h2" style={{ fontSize: 23 }}>
              birdsI could not answer that
            </h3>
            <p className="t-small c2">{error} Your question is kept below. Send it again, or ask a shorter question.</p>
            <div className="flex justify-end">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => send(draft)} disabled={!draft.trim()}>
                Send again
              </button>
            </div>
          </div>
        )}
      </div>

      <form
        className="flex flex-col gap-2.5"
        style={{ padding: "16px 20px 20px", borderTop: "1px solid var(--line)" }}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor={`ask-${variant}`} className="sr-only">
          Ask a question
        </label>
        <div className="flex items-end gap-2.5" style={{ padding: "10px 10px 10px 14px", border: "1px solid var(--edge)", borderRadius: 10, background: "var(--code-bg)" }}>
          <textarea
            id={`ask-${variant}`}
            rows={2}
            value={draft}
            maxLength={2000}
            placeholder={`Ask about ${name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            className="flex-grow"
            style={{ resize: "none", border: 0, outline: "none", background: "transparent", color: "var(--text)", font: "400 15px/1.5 var(--sans)" }}
          />
          <button className="btn btn-primary btn-sm" type="submit" aria-label="Send" disabled={pending || !draft.trim()} style={{ width: 36, height: 36, padding: 0 }}>
            <ArrowUp {...icon} />
          </button>
        </div>
        <span className="t-small c3">birdsI answers from your code and its findings, and names every file it used.</span>
      </form>
    </div>
  );
}
