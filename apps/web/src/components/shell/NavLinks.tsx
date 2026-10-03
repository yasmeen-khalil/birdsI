"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "findings", label: "Findings", path: "/findings" },
  { key: "dependencies", label: "Dependencies", path: "/dependencies" },
  { key: "vendors", label: "Vendors", path: "/vendors" },
  { key: "agent", label: "Agent", path: "/agent" },
  { key: "audit", label: "Pre-launch audit", path: "/audit" },
] as const;

export function activeNav(pathname: string, repoId: string): string | null {
  const base = `/app/${repoId}`;
  if (pathname === base) return "overview";
  for (const item of NAV_ITEMS) if (item.path && pathname.startsWith(base + item.path)) return item.key;
  return null;
}

export function NavLinks({ repoId }: { repoId: string }) {
  const pathname = usePathname();
  const active = activeNav(pathname, repoId);
  return (
    <nav className="nav" aria-label="Repository">
      {NAV_ITEMS.map((item) => (
        <Link key={item.key} href={`/app/${repoId}${item.path}`} className={active === item.key ? "on" : undefined} aria-current={active === item.key ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
