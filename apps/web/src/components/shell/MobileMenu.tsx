"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { icon20 } from "../icon";
import { activeNav, NAV_ITEMS } from "./NavLinks";

/** Phone navigation. The sheet opens from the right, where its button is. */
export function MobileMenu({ repoId }: { repoId: string | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const active = repoId ? activeNav(pathname, repoId) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button type="button" className="btn btn-quiet" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)} style={{ width: 44, height: 44, padding: 0 }}>
        <Menu {...icon20} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={() => setOpen(false)} />
          <div className="slide-in-right absolute top-0 right-0 bottom-0 flex flex-col" style={{ width: "min(320px, 88vw)", background: "var(--surface)", borderLeft: "1px solid var(--line-strong)" }}>
            <div className="flex items-center justify-between" style={{ height: 56, padding: "0 8px 0 20px", borderBottom: "1px solid var(--line)" }}>
              <span className="t-h3">Menu</span>
              <button type="button" className="btn btn-quiet" aria-label="Close menu" onClick={() => setOpen(false)} style={{ width: 44, height: 44, padding: 0 }} autoFocus>
                <X {...icon20} />
              </button>
            </div>
            <nav className="flex flex-col" style={{ padding: "8px 12px" }} aria-label="Main" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
              {repoId &&
                NAV_ITEMS.map((item) => (
                  <Link key={item.key} href={`/app/${repoId}${item.path}`} aria-current={active === item.key ? "page" : undefined} className="flex items-center" style={{ minHeight: 48, padding: "0 8px", textDecoration: "none", fontWeight: active === item.key ? 600 : 500, color: active === item.key ? "var(--text)" : "var(--text-2)", borderBottom: "1px solid var(--line)" }}>
                    {item.label}
                  </Link>
                ))}
              <Link href="/settings" className="flex items-center" style={{ minHeight: 48, padding: "0 8px", textDecoration: "none", color: pathname.startsWith("/settings") ? "var(--text)" : "var(--text-2)", fontWeight: 500 }}>
                Settings
              </Link>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
