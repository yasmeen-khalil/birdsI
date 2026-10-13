"use client";

import { ErrorState } from "@/components/ErrorState";
import { Wordmark } from "@/components/Wordmark";

export default function DemoError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <header className="topbar">
        <Wordmark href="/" />
        <span className="tag" style={{ marginLeft: "auto" }}>
          Demo
        </span>
      </header>
      <ErrorState error={error} reset={reset} title="The sample scan did not load" />
    </>
  );
}
