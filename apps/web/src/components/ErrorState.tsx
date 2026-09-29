"use client";

import { useEffect } from "react";

/** A page that could not load: what happened in plain words, and a way to try again. */
export function ErrorState({ error, reset, title = "This page did not load" }: { error: Error & { digest?: string }; reset: () => void; title?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex flex-col px-16 pt-16 pb-16 max-[900px]:px-5 max-[900px]:pt-8">
      <section className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px", maxWidth: 560 }} role="alert">
        <h1 className="t-h2" style={{ fontSize: 23 }}>
          {title}
        </h1>
        <p className="t-small c2">Your scans and findings are saved. This is a connection problem between your browser and birdsI, or birdsI is having trouble right now.</p>
        {error.digest && <p className="t-mono-s c3">Reference: {error.digest}</p>}
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary btn-sm" onClick={reset}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
