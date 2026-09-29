import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "./SiteChrome";

/** Shared layout for the privacy policy and terms: paper, one readable column. */
export function LegalPage({ title, effective, intro, children }: { title: string; effective: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="container-wide flex flex-grow flex-col" style={{ minHeight: "100vh" }}>
      <div className="min-[901px]:py-5">
        <SiteHeader signedIn={false} back />
      </div>
      <main className="flex flex-col gap-10 py-12 min-[901px]:py-20" style={{ maxWidth: 720 }}>
        <header className="flex flex-col gap-4">
          <h1 className="t-display">{title}</h1>
          <p className="t-small c3">Effective {effective}</p>
          <div className="t-body-l c2">{intro}</div>
        </header>
        <div className="flex flex-col gap-10">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5" style={{ paddingTop: 28, borderTop: "1px solid var(--line)" }}>
      <h2 className="t-h2">{title}</h2>
      {children}
    </section>
  );
}

export function LegalP({ children }: { children: ReactNode }) {
  return <p className="t-body c2">{children}</p>;
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="t-body c2 flex flex-col gap-2" style={{ margin: 0, paddingLeft: 20 }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
