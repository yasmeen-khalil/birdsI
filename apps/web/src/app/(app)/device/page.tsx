import type { Metadata } from "next";
import { deviceLoginByUserCode, type DeviceLoginRow } from "@birdsi/db";
import { DeviceApproval, type DeviceState } from "@/components/DeviceApproval";
import { Frame } from "@/components/Frame";
import { TopBar } from "@/components/shell/TopBar";
import { appUser, toOption, userRepos } from "@/components/server/data";

export const metadata: Metadata = { title: "Sign in from the terminal" };

/** What the page shows first for a code that came in the link from the terminal. */
function stateOf(row: DeviceLoginRow | null): DeviceState {
  if (!row) return "not_found";
  if (row.status === "expired") return "expired";
  if (row.status !== "pending") return "already_used";
  return new Date(row.expires_at).getTime() < Date.now() ? "expired" : "form";
}

export default async function DevicePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const user = await appUser();
  const repos = await userRepos(user.id);
  const initialCode = (code ?? "").slice(0, 16).toUpperCase();

  const initialState = initialCode ? stateOf(await deviceLoginByUserCode(initialCode)) : "form";

  return (
    <>
      <TopBar login={user.github_login ?? user.email} repos={repos.map(toOption)} current={null} />
      <main className="grid grid-cols-1 gap-y-10 px-16 pt-16 pb-12 max-[900px]:px-5 max-[900px]:pt-8 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
        <section className="flex flex-col gap-5 min-[901px]:col-span-5">
          <h1 className="t-h1">Sign in the birdsI terminal tool</h1>
          <p className="t-body-l c2">Your terminal asked to sign in as {user.github_login ?? "you"}. Approve only if you just ran npx birdsi login yourself.</p>
          <ul className="t-small c2 flex flex-col gap-2" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Approving creates a token for that terminal. Your coding AI can use it through the MCP server.</li>
            <li>It can start scans and read findings for your repositories, and open pull requests only when you say yes.</li>
            <li>You can revoke it at any time in Settings.</li>
          </ul>
        </section>
        <Frame arm={24} bend={12} className="flex flex-col px-[30px] py-7 min-[901px]:col-span-6 min-[901px]:col-start-7">
          <DeviceApproval initialCode={initialCode} initialState={initialState} />
        </Frame>
      </main>
    </>
  );
}
