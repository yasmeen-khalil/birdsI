import {
  RECORD_AUTHOR_LABEL,
  RECORD_KIND_LABEL,
  type RecordEntry,
} from "@birdsi/shared";
import { LocalTime } from "../LocalTime";

/**
 * The record, newest first: the kind on the left, the entry in the middle, the
 * time on the right (on a phone the kind and the time share the first line).
 * Decisions are what agents check before they act, so they read a step
 * stronger, by weight and ink only: the text takes the kind label's weight.
 */
export function RecordPanel({
  entries,
  limit = 30,
}: {
  entries: RecordEntry[];
  limit?: number;
}) {
  return (
    <>
      <ol className="m-0 flex list-none flex-col p-0">
        {entries.map((e, i) => {
          const decision = e.kind === "decision";
          return (
            <li
              key={e.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 min-[901px]:grid-cols-[130px_minmax(0,1fr)_140px] min-[901px]:gap-x-6"
              style={{
                padding: "14px 0",
                borderTop: "1px solid var(--line)",
                ...(i === entries.length - 1
                  ? { borderBottom: "1px solid var(--line)" }
                  : {}),
              }}
            >
              <span className={decision ? "t-label" : "t-label c2"}>
                {RECORD_KIND_LABEL[e.kind]}
              </span>
              <div
                className="col-span-2 row-start-2 flex min-w-0 flex-col gap-1.5 wrap-break-word min-[901px]:col-2 min-[901px]:row-start-1"
                style={{ maxWidth: 720 }}
              >
                <p
                  className="t-body"
                  style={decision ? { fontWeight: 500 } : undefined}
                >
                  {e.text}
                </p>
                {e.why && <p className="t-small c2">{e.why}</p>}
                <span className="t-small c3 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    By {e.authorLabel ?? RECORD_AUTHOR_LABEL[e.authorKind]}
                  </span>
                  {e.subject && (
                    <span className="tag max-w-full">
                      <span className="truncate">{e.subject}</span>
                    </span>
                  )}
                </span>
              </div>
              <span className="t-small c3 col-start-2 row-start-1 text-right min-[901px]:col-start-3">
                <LocalTime iso={e.createdAt} style="list" />
              </span>
            </li>
          );
        })}
      </ol>
      {entries.length >= limit && (
        <p className="t-small c3" style={{ marginTop: 12 }}>
          The latest {limit}. Everything, with filters:{" "}
          <span className="path">npx birdsi record</span>.
        </p>
      )}
    </>
  );
}
