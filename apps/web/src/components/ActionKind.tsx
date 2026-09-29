import type { ActionKind as Kind } from "@birdsi/shared";
import { GitPullRequest, ListChecks } from "lucide-react";
import { icon } from "./icon";

export function ActionKind({ kind, strong = false, className }: { kind: Kind; strong?: boolean; className?: string }) {
  const style = strong ? { fontSize: 14, fontWeight: 600, color: "var(--text)" } : undefined;
  return kind === "fix" ? (
    <span className={`act fix${className ? ` ${className}` : ""}`} style={style}>
      <GitPullRequest {...icon} />
      birdsI can fix this
    </span>
  ) : (
    <span className={`act${className ? ` ${className}` : ""}`} style={style}>
      <ListChecks {...icon} />
      You need to do this
    </span>
  );
}
