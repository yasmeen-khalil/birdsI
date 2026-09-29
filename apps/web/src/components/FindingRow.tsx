import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Finding } from "@birdsi/shared";
import { ActionKind } from "./ActionKind";
import { ConfidencePill } from "./Confidence";
import { SeverityMeter } from "./Severity";
import { locationText } from "./format";
import { icon } from "./icon";

export type FindingSummary = Pick<Finding, "id" | "title" | "severity" | "confidence" | "actionKind" | "location" | "status">;

/** One finding as a single link: severity, title and place, confidence, who acts. */
export function FindingRow({ finding, href, selected = false, last = false, showAction = true }: { finding: FindingSummary; href: string; selected?: boolean; last?: boolean; showAction?: boolean }) {
  const dismissed = finding.status === "dismissed";
  const statusTag = finding.status === "pr_open" ? "Pull request open" : finding.status === "fixed" ? "Fixed" : dismissed ? "Dismissed" : null;
  return (
    <Link
      className={`frow${selected ? " sel" : ""}${dismissed ? " dismissed" : ""}`}
      href={href}
      style={{ ...(last ? { borderBottom: "1px solid var(--line)" } : {}), ...(showAction ? {} : { gridTemplateColumns: "104px minmax(0, 1fr) 132px 16px" }) }}
    >
      <SeverityMeter severity={finding.severity} className="hide-m" />
      <span className="min-w-0">
        <span className="mb-2 flex items-center justify-between gap-3 min-[901px]:hidden">
          <SeverityMeter severity={finding.severity} />
          <ConfidencePill confidence={finding.confidence} />
        </span>
        <span className="ti">
          {finding.title}
          {statusTag && (
            <span className={`tag${finding.status === "fixed" ? " ok" : ""}`} style={{ marginLeft: 8, height: 20, fontSize: 11.5, verticalAlign: 1 }}>
              {statusTag}
            </span>
          )}
        </span>
        {finding.location && <span className="wh path max-[900px]:whitespace-normal!">{locationText(finding.location)}</span>}
        {showAction && (
          <span className="mt-2 block min-[901px]:hidden">
            <ActionKind kind={finding.actionKind} />
          </span>
        )}
      </span>
      <ConfidencePill confidence={finding.confidence} className="hide-m" />
      {showAction && <ActionKind kind={finding.actionKind} className="hide-m" />}
      <ChevronRight {...icon} className="i c3" />
    </Link>
  );
}
