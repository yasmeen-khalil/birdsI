"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncVendorsAction } from "@/lib/actions";
import { ButtonArc } from "../Arc";
import { Toast } from "../Toast";
import { icon } from "../icon";

/** Queues the vendor stage alone and reports what happened. */
export function useRefreshVendors(repoId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const refresh = () =>
    start(async () => {
      setNotice(null);
      const r = await syncVendorsAction(repoId);
      if (!r.ok) setNotice({ tone: "error", text: r.message });
      else if (!r.data.queued) setNotice({ tone: "error", text: r.data.reason ?? "The vendor refresh could not start." });
      else {
        setNotice({ tone: "ok", text: "Refreshing vendors. Plans, usage and limits update in a minute or two." });
        router.refresh();
      }
    });
  const toast = notice ? (
    <Toast tone={notice.tone} onClose={() => setNotice(null)}>
      {notice.text}
    </Toast>
  ) : null;
  return { refresh, pending, toast };
}

export function RefreshVendorsButton({ repoId, running }: { repoId: string; running: boolean }) {
  const { refresh, pending, toast } = useRefreshVendors(repoId);
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" disabled={pending || running} onClick={refresh}>
        {pending || running ? <ButtonArc /> : <RefreshCw {...icon} />}
        {running ? "Refreshing vendors" : "Refresh vendors"}
      </button>
      {toast}
    </>
  );
}
