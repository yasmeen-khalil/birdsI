"use client";

import { ErrorState } from "@/components/ErrorState";

export default function RepoError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} reset={reset} />;
}
