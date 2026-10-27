import Link from "next/link";
import type { Metadata } from "next";
import { Github } from "lucide-react";
import { repoWithInstallation, userById } from "@birdsi/db";
import type { CockpitView } from "@birdsi/shared";
import { AppIcon } from "@/components/Logos";
import { CockpitSections } from "@/components/cockpit/Cockpit";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { icon } from "@/components/icon";
import { currentUserRow } from "@/lib/auth";
import { loadCockpit } from "@/lib/cockpit";

export const metadata: Metadata = { title: "Demo" };
export const dynamic = "force-dynamic";

async function signedIn(): Promise<boolean> {
  try {
    return (await currentUserRow()) !== null;
  } catch {
    return false;
  }
}

/**
 * The cockpit of the sample app the owner named in BIRDSI_DEMO_REPO_ID,
 * loaded as its owner sees it and shown to anyone. Nothing here can be
 * changed from this page, and no key is ever part of a cockpit view.
 */
async function demoCockpit(): Promise<{ repoId: string; view: CockpitView } | null> {
  const repoId = process.env["BIRDSI_DEMO_REPO_ID"]?.trim();
  if (!repoId) return null;
  try {
    const { repo } = await repoWithInstallation(repoId);
    const owner = await userById(repo.owner_user_id);
    if (!owner) return null;
    return { repoId: repo.id, view: await loadCockpit(repo.id, owner) };
  } catch {
    return null;
  }
}

export default async function DemoPage() {
  const [isSignedIn, demo] = await Promise.all([signedIn(), demoCockpit()]);
  return (
    <div className="fog flex flex-grow flex-col">
      <div className="container-wide flex flex-grow flex-col" style={{ minHeight: "100vh" }}>
        <div className="min-[901px]:py-5">
          <SiteHeader signedIn={isSignedIn} />
        </div>
        <main className="flex flex-col gap-[72px] pt-12 pb-16 max-[900px]:gap-12 max-[900px]:pt-7 max-[900px]:pb-10">
          <section className="flex flex-col gap-3" style={{ maxWidth: 760 }} aria-label="About this demo">
            <p className="t-readout c3">Demo</p>
            {demo ? (
              <>
                <div className="flex items-center gap-3">
                  <AppIcon name={demo.view.appName} base={demo.view.appIconBase} />
                  <h1 className="t-h1 break-words">{demo.view.appName}</h1>
                </div>
                <p className="t-body c2">
                  The cockpit of a sample app, read the way birdsI reads any app: the map of its code by rules and then by the model, the accounts behind it with their own keys, and what needs its owner. Every line says where it came from, and what the model read is marked as the model&apos;s reading. This page only shows. Sign in with GitHub to add your own apps.
                </p>
              </>
            ) : (
              <>
                <h1 className="t-h1">No sample app is set up on this birdsI yet</h1>
                <p className="t-body c2">The owner maps a sample app and names it in BIRDSI_DEMO_REPO_ID, and its cockpit shows here for anyone to read.</p>
              </>
            )}
            {!isSignedIn && (
              <div>
                <Link className="btn btn-primary" href="/sign-in">
                  <Github {...icon} />
                  Sign in
                </Link>
              </div>
            )}
          </section>
          {demo && <CockpitSections view={demo.view} repoId={demo.repoId} />}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
