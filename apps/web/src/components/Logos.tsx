"use client";

import { useState } from "react";
import { appIconCandidates } from "@birdsi/shared";

/** Logos load from Simple Icons' address. NEXT_PUBLIC_BIRDSI_LOGOS=off keeps every list to letter tiles. */
const LOGOS_ON = process.env["NEXT_PUBLIC_BIRDSI_LOGOS"] !== "off";

function Tile({ name, size, radius }: { name: string; size: number; radius: number }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size, borderRadius: radius, background: "var(--line)", color: "var(--text-2)", fontSize: Math.round(size * 0.46), fontWeight: 600 }}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** A vendor's logo from its known address, or a letter tile when there is none or it does not load. */
export function ServiceIcon({ name, url, size = 24 }: { name: string; url: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!LOGOS_ON || !url || failed) return <Tile name={name} size={size} radius={7} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: 7, objectFit: "contain", flexShrink: 0 }} />;
}

/** The app's own icon from its live address, trying the usual files in order, or a letter tile. */
export function AppIcon({ name, base, size = 40 }: { name: string; base: string | null; size?: number }) {
  const candidates = appIconCandidates(base);
  const [index, setIndex] = useState(0);
  const url = candidates[index] ?? null;
  if (!url) return <Tile name={name} size={size} radius={10} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={size} height={size} onError={() => setIndex((i) => i + 1)} style={{ width: size, height: size, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />;
}
