import type { ScanEvent, ScanEventRecord, ScanStep } from "@birdsi/shared";
import {
  STEP_LABEL,
  STEP_UNIT,
  findingRow,
  formatClock,
  formatDuration,
  glyphs,
  paint,
  stripAnsi,
  type Style,
} from "./format";

type StepState = "pending" | "running" | "done" | "failed";

interface StepView {
  step: ScanStep;
  label: string;
  state: StepState;
  done: number | undefined;
  total: number | undefined;
  findings: number;
  durationMs: number | undefined;
  file: string | undefined;
}

/** Cuts a line to a visible width, keeping ANSI escapes intact. */
export function truncateVisible(line: string, max: number): string {
  if (stripAnsi(line).length <= max) return line;
  let out = "";
  let visible = 0;
  for (let i = 0; i < line.length; ) {
    if (line[i] === "\x1b") {
      const match = /^\x1b\[[0-9;]*[A-Za-z]/.exec(line.slice(i));
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    if (visible >= max - 1) {
      out += ".";
      break;
    }
    out += line[i];
    visible += 1;
    i += 1;
  }
  return out + "\x1b[0m";
}

/** The done line for a step: label, what it counted, how long it took. */
export function stepDoneLine(view: Pick<StepView, "step" | "label" | "done" | "total" | "findings" | "durationMs">, style: Style): string {
  const count = view.done ?? view.total;
  const detail = [count !== undefined ? `${count} ${STEP_UNIT[view.step]}` : null, view.findings > 0 ? `${view.findings} found` : null]
    .filter((p): p is string => p !== null)
    .join(", ");
  const duration = view.durationMs !== undefined ? formatDuration(view.durationMs) : "";
  return `  ${paint.ok(style, glyphs(style).done)} ${view.label.padEnd(29)}${detail.padEnd(13)}${duration.padStart(8)}`.trimEnd();
}

/**
 * Draws scan progress. On a terminal, the step list is redrawn in place
 * with the file being read shown dim under the running step; findings and
 * notes print above it as they arrive. Elsewhere (CI logs, pipes), every
 * change is a new line.
 */
export class ScanProgress {
  private readonly out: NodeJS.WriteStream;
  private readonly style: Style;
  private readonly live: boolean;
  private readonly startedAt = Date.now();
  private steps: StepView[] = [];
  private liveLines = 0;
  private status: string | null = null;
  private inventoryFiles: number | undefined;
  private cursorHidden = false;
  findingsSeen = 0;

  constructor(out: NodeJS.WriteStream, style: Style) {
    this.out = out;
    this.style = style;
    this.live = Boolean(out.isTTY);
  }

  /** A status line shown under the steps (e.g. "Stopping the map."). */
  setStatus(text: string | null): void {
    this.status = text;
    this.redraw();
  }

  /** 1-based number of the step that was running when the scan ended, if any. */
  get currentStepNumber(): number | null {
    const i = this.steps.findIndex((s) => s.state === "running" || s.state === "failed");
    return i >= 0 ? i + 1 : null;
  }

  handle(records: readonly ScanEventRecord[]): void {
    for (const record of records) this.apply(record.event);
    this.redraw();
  }

  tick(): void {
    this.redraw();
  }

  /** Commits the final state of the step list and stops drawing in place. */
  finish(outcome: "done" | "failed" | "stopped" | "running"): void {
    if (outcome === "failed") {
      const running = this.steps.find((s) => s.state === "running");
      if (running) running.state = "failed";
    }
    if (this.live) {
      this.clear();
      const lines = this.stepLines(false);
      if (lines.length > 0) this.out.write(lines.map((l) => this.fit(l)).join("\n") + "\n");
      this.showCursor();
    }
  }

  /** Prints a line above the live region. */
  print(line: string): void {
    if (this.live) {
      this.clear();
      this.out.write(line + "\n");
      this.draw();
    } else {
      this.out.write(line + "\n");
    }
  }

  private apply(event: ScanEvent): void {
    switch (event.type) {
      case "scan_started":
        this.steps = event.steps.map((step) => ({
          step,
          label: STEP_LABEL[step],
          state: "pending",
          done: undefined,
          total: undefined,
          findings: 0,
          durationMs: undefined,
          file: undefined,
        }));
        return;
      case "step_started": {
        const view = this.ensure(event.step);
        view.state = "running";
        view.label = event.label || view.label;
        if (event.total !== undefined) view.total = event.total;
        if (!this.live) this.out.write(`  ${glyphs(this.style).running} ${view.label}\n`);
        return;
      }
      case "step_progress": {
        const view = this.ensure(event.step);
        view.done = event.done;
        if (event.total !== undefined) view.total = event.total;
        return;
      }
      case "file_reading": {
        const view = this.ensure(event.step);
        view.file = event.path;
        return;
      }
      case "inventory":
        this.inventoryFiles = event.filesSeen;
        return;
      case "finding":
        this.findingsSeen += 1;
        this.print(findingRow(event.finding, this.style));
        return;
      case "step_done": {
        const view = this.ensure(event.step);
        view.state = "done";
        view.findings = event.findings;
        view.durationMs = event.durationMs;
        view.file = undefined;
        if (view.step === "inventory" && view.done === undefined && this.inventoryFiles !== undefined) view.done = this.inventoryFiles;
        if (!this.live) this.out.write(stepDoneLine(view, this.style) + "\n");
        return;
      }
      case "audit_area":
        // Written only by the pre-launch audit, removed in v3.
        return;
      case "note":
        this.print(paint.dim(this.style, `  ${event.text}`));
        return;
      case "scan_done":
      case "scan_failed":
      case "scan_stopped":
        return;
    }
  }

  private ensure(step: ScanStep): StepView {
    let view = this.steps.find((s) => s.step === step);
    if (!view) {
      view = { step, label: STEP_LABEL[step], state: "pending", done: undefined, total: undefined, findings: 0, durationMs: undefined, file: undefined };
      this.steps.push(view);
    }
    return view;
  }

  private stepLines(withFile: boolean): string[] {
    const g = glyphs(this.style);
    const lines: string[] = [];
    for (const view of this.steps) {
      if (view.state === "done") {
        lines.push(stepDoneLine(view, this.style));
      } else if (view.state === "running") {
        const progress =
          view.done !== undefined && view.total !== undefined
            ? `${view.done} of ${view.total}`
            : view.done !== undefined
              ? `${view.done} ${STEP_UNIT[view.step]}`
              : "";
        lines.push(`  ${paint.accent(this.style, g.running)} ${paint.bold(this.style, `${view.label.padEnd(29)}${progress}`.trimEnd())}`);
        if (withFile && view.file) lines.push(paint.dim(this.style, `    reading ${view.file}`));
      } else if (view.state === "failed") {
        lines.push(`  ${paint.fail(this.style, g.failed)} ${view.label}`);
      } else {
        lines.push(paint.dim(this.style, `  ${g.pending} ${view.label}`));
      }
    }
    return lines;
  }

  private regionLines(): string[] {
    const lines = this.stepLines(true);
    if (lines.length === 0) lines.push(paint.dim(this.style, "  Waiting for birdsI to start the map."));
    lines.push("");
    const elapsed = formatClock(Date.now() - this.startedAt);
    lines.push(paint.dim(this.style, `  ${elapsed}. ${this.status ?? "Ctrl+C stops the map."}`));
    return lines;
  }

  private fit(line: string): string {
    const columns = this.out.columns || 100;
    return truncateVisible(line, Math.max(20, columns - 1));
  }

  private clear(): void {
    if (this.liveLines > 0) {
      this.out.write(`\x1b[${this.liveLines}A\r\x1b[J`);
      this.liveLines = 0;
    }
  }

  private draw(): void {
    if (!this.live) return;
    if (!this.cursorHidden) {
      this.cursorHidden = true;
      this.out.write("\x1b[?25l");
      process.once("exit", () => this.showCursor());
    }
    const lines = this.regionLines().map((l) => this.fit(l));
    this.out.write(lines.join("\n") + "\n");
    this.liveLines = lines.length;
  }

  private redraw(): void {
    if (!this.live) return;
    this.clear();
    this.draw();
  }

  private showCursor(): void {
    if (this.cursorHidden) {
      this.cursorHidden = false;
      this.out.write("\x1b[?25h");
    }
  }
}
