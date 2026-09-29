"use client";

import { ErrorState } from "@/components/ErrorState";

export default function DemoError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} reset={reset} title="The sample scan did not load" />;
}
