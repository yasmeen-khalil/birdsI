import Link from "next/link";
import { Frame } from "@/components/Frame";
import { Wordmark } from "@/components/Wordmark";

export default function NotFound() {
  return (
    <div className="night flex min-h-screen flex-col">
      <header className="topbar">
        <Wordmark href="/" />
      </header>
      <main className="flex flex-grow items-start px-16 pt-16 max-[900px]:px-5 max-[900px]:pt-8">
        <Frame arm={24} bend={12} className="flex flex-col gap-4 px-8 py-10" style={{ maxWidth: 560 }}>
          <h1 className="t-h1">Nothing here</h1>
          <p className="t-body c2">This page does not exist, or it belongs to another account. Check the address, or go back to your repositories.</p>
          <div className="flex flex-wrap justify-end gap-3">
            <Link className="btn btn-secondary btn-sm" href="/">
              Home page
            </Link>
            <Link className="btn btn-primary btn-sm" href="/app">
              Your repositories
            </Link>
          </div>
        </Frame>
      </main>
    </div>
  );
}
