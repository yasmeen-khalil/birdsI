import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ALERT_KIND_LABEL, type AppAlert } from "@birdsi/shared";
import { LocalTime } from "../LocalTime";
import { safeUrl } from "../format";
import { icon14 } from "../icon";

const SEVERITY_TAG: Record<AppAlert["severity"], { label: string; className: string }> = {
  critical: { label: "Critical", className: "tag bad" },
  warning: { label: "Warning", className: "tag warn" },
  notice: { label: "Notice", className: "tag" },
};

function emailLine(alert: AppAlert): string | null {
  if (!alert.emailStatus) return null;
  if (alert.emailStatus === "sent") return "Emailed.";
  return `Not emailed: ${alert.emailStatus.replace(/^not sent: /, "").replace(/\.?$/, ".")}`;
}

/** One alert: its sentence, what to do, where the evidence is, and when it opened, was last seen and closed. */
export function AlertItem({ alert, compact = false }: { alert: AppAlert; compact?: boolean }) {
  const tag = SEVERITY_TAG[alert.severity];
  const link = safeUrl(alert.source.url);
  const where = alert.source.path ? `${alert.source.path}${alert.source.line ? `:${alert.source.line}` : ""}` : null;
  const email = emailLine(alert);
  return (
    <article className="flex flex-col gap-2" style={{ padding: "16px 0", borderBottom: "1px solid var(--line)", opacity: alert.resolvedAt ? 0.7 : 1 }}>
      <div className="flex flex-wrap items-center gap-2">
        {alert.resolvedAt ? <span className="tag ok">Closed</span> : <span className={tag.className}>{tag.label}</span>}
        <span className="t-label c3">{ALERT_KIND_LABEL[alert.kind]}</span>
      </div>
      <p className="t-body" style={{ maxWidth: 820 }}>
        {alert.sentence}
      </p>
      {alert.action && !alert.resolvedAt && <p className="t-small c2">{alert.action}</p>}
      {!compact && (
        <p className="t-small c3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Opened <LocalTime iso={alert.openedAt} style="relative" />
            {alert.resolvedAt ? (
              <>
                , closed <LocalTime iso={alert.resolvedAt} style="relative" />
              </>
            ) : (
              <>
                , last seen <LocalTime iso={alert.seenAt} style="relative" />
              </>
            )}
            .
          </span>
          {email && <span>{email}</span>}
          {where && <span className="t-mono-s">{where}</span>}
          {link && (
            <a className="c2 inline-flex items-center gap-1" href={link} target="_blank" rel="noreferrer">
              {alert.source.label || "Source"}
              <ExternalLink {...icon14} />
            </a>
          )}
        </p>
      )}
    </article>
  );
}

export function AlertFilterLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={on ? "tag run" : "tag"} aria-current={on ? "true" : undefined} scroll={false}>
      {children}
    </Link>
  );
}
