"use client";

import { ErrorState } from "@/components/ErrorState";
import { Wordmark } from "@/components/Wordmark";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <header className="topbar">
        <Wordmark href="/app" />
        <span className="tag" style={{ marginLeft: "auto" }}>
          Demo
        </span>
      </header>
      <ErrorState error={error} reset={reset} />
    </>
  );
}
