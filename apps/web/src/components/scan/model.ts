import type { AuditArea, FindingDraft, ScanEventRecord, ScanKind, ScanStatus, ScanStep } from "@birdsi/shared";

/**
 * Pure reduction of a scan's event log into what the live view shows.
 * Shared by the full live scan and the compact progress card.
 */

export type StepState = "waiting" | "running" | "done" | "halted";

export interface StepView {
  step: ScanStep;
  label: string;
  state: StepState;
  done?: number;
  total?: number;
  findings?: number;
  durationMs?: number;
  startedAt?: string;
}

export interface ScanView {
  kind: ScanKind | null;
  steps: StepView[];
  runningIndex: number;
  inventory: { filesSeen: number; filesToRead: number; languages: Array<{ name: string; files: number }>; folders: Array<{ name: string; files: string[] }> } | null;
  reading: { path: string; checks: string[]; step: ScanStep } | null;
  readPaths: string[];
  findings: Array<FindingDraft & { id: string }>;
  notes: string[];
  areas: Array<{ area: AuditArea; verdict: "pass" | "attention" | "blocker"; note: string }>;
  finished: { findings: number; durationMs: number } | null;
  failed: string | null;
  stopped: boolean;
  startedAt: string | null;
  lastAt: string | null;
  progress: number;
}

const UNITS: Partial<Record<ScanStep, [string, string]>> = {
  inventory: ["file", "files"],
  dependencies: ["package", "packages"],
  vendors: ["service", "services"],
  secrets: ["file", "files"],
  vulnerabilities: ["package", "packages"],
  docs: ["library", "libraries"],
  review: ["file", "files"],
};

export function unitFor(step: ScanStep, n: number): string {
  const u = UNITS[step];
  if (!u) return "";
  return n === 1 ? u[0] : u[1];
}

export function deriveScanView(events: ScanEventRecord[], stepLabels: Record<string, string>): ScanView {
  const view: ScanView = {
    kind: null,
    steps: [],
    runningIndex: -1,
    inventory: null,
    reading: null,
    readPaths: [],
    findings: [],
    notes: [],
    areas: [],
    finished: null,
    failed: null,
    stopped: false,
    startedAt: events[0]?.at ?? null,
    lastAt: events[events.length - 1]?.at ?? null,
    progress: 0,
  };
  const read = new Set<string>();
  const stepAt = (step: ScanStep): StepView => {
    let s = view.steps.find((x) => x.step === step);
    if (!s) {
      s = { step, label: stepLabels[step] ?? step, state: "waiting" };
      view.steps.push(s);
    }
    return s;
  };

  for (const { event, at } of events) {
    switch (event.type) {
      case "scan_started":
        view.kind = event.kind;
        for (const step of event.steps) stepAt(step);
        break;
      case "step_started": {
        const s = stepAt(event.step);
        s.state = "running";
        s.startedAt = at;
        if (event.label) s.label = event.label;
        if (event.total !== undefined) s.total = event.total;
        break;
      }
      case "step_progress": {
        const s = stepAt(event.step);
        if (s.state === "waiting") s.state = "running";
        s.done = event.done;
        if (event.total !== undefined) s.total = event.total;
        break;
      }
      case "file_reading":
        view.reading = { path: event.path, checks: event.checks, step: event.step };
        read.add(event.path);
        break;
      case "inventory": {
        view.inventory = { filesSeen: event.filesSeen, filesToRead: event.filesToRead, languages: event.languages, folders: event.folders };
        const s = stepAt("inventory");
        s.total = event.filesSeen;
        s.done = event.filesSeen;
        break;
      }
      case "finding":
        if (!view.findings.some((f) => f.id === event.finding.id)) view.findings.push(event.finding);
        break;
      case "step_done": {
        const s = stepAt(event.step);
        s.state = "done";
        s.findings = event.findings;
        s.durationMs = event.durationMs;
        if (s.total !== undefined) s.done = s.total;
        if (view.reading?.step === event.step) view.reading = null;
        break;
      }
      case "audit_area":
        view.areas = view.areas.filter((a) => a.area !== event.area).concat({ area: event.area, verdict: event.verdict, note: event.note });
        break;
      case "note":
        view.notes.push(event.text);
        break;
      case "scan_done":
        view.finished = { findings: event.findings, durationMs: event.durationMs };
        view.reading = null;
        break;
      case "scan_failed":
        view.failed = event.error;
        view.reading = null;
        break;
      case "scan_stopped":
        view.stopped = true;
        view.reading = null;
        break;
    }
  }

  view.readPaths = [...read];
  view.runningIndex = view.steps.findIndex((s) => s.state === "running");
  if ((view.failed !== null || view.stopped) && view.runningIndex >= 0) {
    view.steps[view.runningIndex]!.state = "halted";
  }
  if (view.finished) {
    for (const s of view.steps) if (s.state !== "done") s.state = "done";
  }

  const total = view.steps.length;
  if (total > 0) {
    const complete = view.steps.filter((s) => s.state === "done").length;
    const running = view.steps[view.runningIndex];
    const fraction = running && running.total && running.done ? Math.min(1, running.done / running.total) : 0;
    view.progress = view.finished ? 1 : Math.min(0.99, (complete + fraction) / total);
  }
  return view;
}

export function isTerminal(status: ScanStatus): boolean {
  return status === "done" || status === "failed" || status === "stopped";
}

/** The plain line shown to the right of a step. */
export function stepDetail(s: StepView): string {
  if (s.state === "waiting") return "waiting";
  if (s.state === "halted") return "stopped";
  if (s.state === "running") {
    if (s.total !== undefined && s.total > 0) return `${s.done ?? 0} of ${s.total} ${unitFor(s.step, s.total)}`.trim();
    return "running";
  }
  if (s.step === "rank") return s.findings !== undefined ? `${s.findings} ${s.findings === 1 ? "finding" : "findings"}` : "";
  const parts: string[] = [];
  if (s.total !== undefined && UNITS[s.step]) parts.push(`${s.total} ${unitFor(s.step, s.total)}`);
  if (s.findings) parts.push(`${s.findings} found`);
  return parts.join(", ");
}
