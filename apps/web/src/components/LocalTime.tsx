"use client";

import { useSyncExternalStore } from "react";
import { formatWhen } from "./format";

const subscribe = () => () => {};

/**
 * A time in the viewer's own time zone. The server renders a stable date so
 * the page never shows a wrong clock time before the browser takes over.
 */
export function LocalTime({ iso, style = "sentence" }: { iso: string | null | undefined; style?: "sentence" | "list" | "date" | "relative" }) {
  const onClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!iso) return null;
  const text = onClient ? formatWhen(iso, style) : formatWhen(iso, "date");
  return <time dateTime={iso}>{text}</time>;
}
