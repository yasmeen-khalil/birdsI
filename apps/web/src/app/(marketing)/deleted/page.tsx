import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Frame } from "@/components/Frame";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { EndSession } from "@/components/marketing/EndSession";
import { icon } from "@/components/icon";

export const metadata: Metadata = { title: "Account deleted" };

export default function DeletedPage() {
  return (
    <div className="container-wide flex flex-grow flex-col" style={{ minHeight: "100vh" }}>
      <EndSession />
      <div className="min-[901px]:py-5">
        <SiteHeader signedIn={false} />
      </div>
      <main className="flex flex-grow items-start py-16">
        <Frame arm={40} bend={20} bracket="var(--text-2)" className="flex w-full flex-col gap-5 px-8 py-12 min-[901px]:px-16" style={{ maxWidth: 760 }}>
          <h1 className="t-display">Your account is deleted</h1>
          <p className="t-body-l c2">birdsI removed your findings, scans, vendor details and chats. To remove its GitHub App as well, uninstall it on GitHub.</p>
          <div className="flex flex-wrap justify-end gap-3" style={{ marginTop: 8 }}>
            <a className="btn btn-secondary" href="https://github.com/settings/installations" target="_blank" rel="noreferrer">
              Open GitHub settings
              <ExternalLink {...icon} />
            </a>
          </div>
        </Frame>
      </main>
      <SiteFooter />
    </div>
  );
}
