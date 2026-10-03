import { LoadingRegion, Skeleton } from "./Skeleton";

/** Skeletons shaped like the pages they stand in for. */

export function OverviewSkeleton() {
  return (
    <LoadingRegion label="Loading the overview" className="flex flex-col gap-16 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-3" style={{ width: "40%" }}>
          <Skeleton height={34} width="70%" />
          <Skeleton width="90%" />
        </div>
        <div className="flex gap-3 max-[900px]:hidden">
          <Skeleton width={130} height={56} />
          <Skeleton width={130} height={56} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-10 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
        <div className="flex flex-col gap-4 min-[901px]:col-span-7">
          <Skeleton height={40} width="85%" />
          <Skeleton height={40} width="55%" />
          <Skeleton width="70%" style={{ marginTop: 8 }} />
          <div className="mt-8 flex flex-wrap gap-7">
            {[90, 60, 80, 50, 70, 40].map((w, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton width={w} height={9} />
                <Skeleton width={w * 1.2} height={48} />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 min-[901px]:col-span-4 min-[901px]:col-start-9">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} height={18} />
          ))}
        </div>
      </div>
      <RowsSkeleton rows={3} />
    </LoadingRegion>
  );
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[60px_minmax(0,1fr)_70px] items-center gap-3.5" style={{ padding: "18px 0", borderTop: "1px solid var(--line)" }}>
          <Skeleton />
          <Skeleton width={`${80 - ((i * 9) % 24)}%`} />
          <Skeleton />
        </div>
      ))}
    </div>
  );
}

export function FindingsSkeleton() {
  return (
    <LoadingRegion label="Loading findings" className="flex flex-col gap-8 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7">
      <div className="flex flex-col gap-3">
        <Skeleton height={34} width={220} />
        <Skeleton width="50%" />
      </div>
      <div className="flex flex-wrap gap-2" style={{ padding: "18px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} width={84} height={28} />
        ))}
      </div>
      <p className="t-small c2">Loading findings</p>
      <RowsSkeleton rows={6} />
    </LoadingRegion>
  );
}

export function DetailSkeleton() {
  return (
    <LoadingRegion label="Loading the finding" className="grid grid-cols-1 gap-10 px-16 pt-16 pb-16 max-[900px]:px-5 max-[900px]:pt-8 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
      <div className="flex flex-col gap-4 min-[901px]:col-span-8">
        <Skeleton width={220} height={20} />
        <Skeleton height={34} width="90%" />
        <Skeleton height={34} width="60%" />
        <Skeleton width="40%" />
        <div className="mt-8 flex flex-col gap-2.5">
          <Skeleton width="95%" />
          <Skeleton width="92%" />
          <Skeleton width="70%" />
        </div>
        <Skeleton height={160} style={{ marginTop: 24 }} />
      </div>
      <div className="flex flex-col gap-5 min-[901px]:col-span-4">
        <Skeleton height={180} />
        <Skeleton height={220} />
      </div>
    </LoadingRegion>
  );
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-8 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7">
      <div className="flex flex-col gap-3">
        <Skeleton height={34} width={260} />
        <Skeleton width="45%" />
      </div>
      <p className="t-small c2">{label}</p>
      <RowsSkeleton rows={5} />
    </LoadingRegion>
  );
}

export function VendorsSkeleton() {
  return (
    <LoadingRegion label="Loading vendors" className="flex flex-col gap-10 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7">
      <div className="flex flex-col gap-3">
        <Skeleton height={34} width={200} />
        <Skeleton width="45%" />
      </div>
      <div className="flex flex-wrap items-end gap-8">
        <Skeleton height={44} width={180} />
        <div className="flex gap-2">
          {[70, 60, 80, 50].map((w, i) => (
            <Skeleton key={i} width={w} height={28} />
          ))}
        </div>
      </div>
      <p className="t-small c2">Loading vendors</p>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="panel grid grid-cols-1 gap-6 min-[901px]:grid-cols-12" style={{ padding: "24px 26px" }}>
            <div className="flex flex-col gap-3 min-[901px]:col-span-5">
              <Skeleton height={24} width="50%" />
              <Skeleton width="90%" />
              <Skeleton width="70%" />
            </div>
            <div className="flex flex-col gap-3 min-[901px]:col-span-7">
              <Skeleton height={18} />
              <Skeleton height={18} width="80%" />
              <Skeleton height={18} width="60%" />
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function AgentSkeleton() {
  return (
    <LoadingRegion label="Loading the agent page" className="flex flex-col gap-12 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7">
      <div className="flex flex-col gap-3">
        <Skeleton height={34} width={160} />
        <Skeleton width="50%" />
      </div>
      {[2, 2, 3].map((rows, s) => (
        <div key={s} className="flex flex-col gap-4">
          <Skeleton height={24} width={220} />
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} height={88} />
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}
