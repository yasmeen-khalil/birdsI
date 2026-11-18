import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { accessList, type UserRow } from "@birdsi/db";
import { DecideAccess } from "@/components/AccessControls";
import { LocalTime } from "@/components/LocalTime";
import { TopBar } from "@/components/shell/TopBar";
import { appUser, toOption, userRepos } from "@/components/server/data";
import { isOwner } from "@/lib/access";

export const metadata: Metadata = { title: "Access", robots: { index: false } };
export const dynamic = "force-dynamic";

function Row({ person, self }: { person: UserRow; self: boolean }) {
  const name = person.github_login ?? person.email ?? "No name";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4" style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="t-body truncate" style={{ fontWeight: 600 }}>
          {person.github_login ? (
            <a href={`https://github.com/${encodeURIComponent(person.github_login)}`} target="_blank" rel="noreferrer">
              {name}
            </a>
          ) : (
            name
          )}
        </span>
        <span className="t-small c3">
          {person.access_requested_at ? (
            <>
              Asked <LocalTime iso={person.access_requested_at} />
            </>
          ) : (
            "Had an account before access by approval"
          )}
        </span>
      </span>
      {self ? <span className="t-small c3">You</span> : <DecideAccess userId={person.id} access={person.access} />}
    </div>
  );
}

function Group({ title, empty, people, ownerId }: { title: string; empty: string; people: UserRow[]; ownerId: string }) {
  return (
    <section className="flex flex-col" style={{ padding: "28px 0" }}>
      <h2 className="t-h3" style={{ paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
        {title} ({people.length})
      </h2>
      {people.length === 0 ? (
        <p className="t-small c3" style={{ padding: "14px 0" }}>
          {empty}
        </p>
      ) : (
        people.map((p) => <Row key={p.id} person={p} self={p.id === ownerId} />)
      )}
    </section>
  );
}

/** The owner's page: who asked to use birdsI, and the decision on each. To anyone else it does not exist. */
export default async function AccessPage() {
  const user = await appUser();
  if (!isOwner(user)) notFound();
  const [repos, people] = await Promise.all([userRepos(user.id), accessList()]);
  const waiting = people.filter((p) => p.access === "pending");
  const approved = people.filter((p) => p.access === "approved");
  const denied = people.filter((p) => p.access === "denied");
  return (
    <>
      <TopBar login={user.github_login ?? user.email ?? ""} repos={repos.map(toOption)} current={null} />
      <main className="flex flex-col px-16 pt-12 pb-12 max-[900px]:px-5 max-[900px]:pt-7" style={{ maxWidth: 920 }}>
        <h1 className="t-h1">Access</h1>
        <p className="t-body c2" style={{ paddingTop: 10 }}>
          Only approved accounts can use birdsI. Everyone else sees a request page and nothing more.
        </p>
        <Group title="Waiting" empty="Nobody is waiting." people={waiting} ownerId={user.id} />
        <Group title="Approved" empty="Nobody is approved yet." people={approved} ownerId={user.id} />
        <Group title="Denied" empty="Nobody was denied." people={denied} ownerId={user.id} />
      </main>
    </>
  );
}
