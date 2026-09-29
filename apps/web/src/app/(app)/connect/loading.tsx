import { LoadingRegion, Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading your repositories" className="grid grid-cols-1 gap-10 px-16 pt-[72px] pb-12 max-[900px]:px-5 max-[900px]:pt-8 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
      <div className="flex flex-col gap-4 min-[901px]:col-span-5">
        <Skeleton height={34} width="80%" />
        <Skeleton width="95%" />
        <Skeleton width="70%" />
        <Skeleton height={80} style={{ marginTop: 16 }} />
      </div>
      <div className="flex flex-col gap-4 min-[901px]:col-span-6 min-[901px]:col-start-7">
        <p className="t-small c2">Loading your repositories from GitHub</p>
        {[44, 36, 52].map((w, i) => (
          <div key={i} className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5">
            <Skeleton width={14} height={14} round />
            <div className="flex flex-col gap-[7px]">
              <Skeleton width={`${w}%`} />
              <Skeleton width={`${w + 22}%`} height={9} />
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
