import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalP, LegalPage, LegalSection } from "@/components/marketing/Legal";

/** Who runs this instance of birdsI. A self-hosted copy names its own operator here. */
const OPERATOR_NAME = "yasmeen-khalil";
const OPERATOR_URL = "https://github.com/yasmeen-khalil";
const EFFECTIVE_DATE = "18 October 2026";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      effective={EFFECTIVE_DATE}
      intro={
        <>
          birdsI maps the code of your apps, and reads the vendor accounts you connect, to show what each app runs on and what needs you. This policy says what it keeps, for how long, who else processes it, and how you remove it. birdsI is run by {OPERATOR_NAME} (“the operator”).
        </>
      }
    >
      <LegalSection title="The short version">
        <LegalList
          items={[
            "Code uploaded by the terminal tool is deleted as soon as its map has run. Your environment files and private keys are never uploaded at all.",
            "The map keeps file paths, line numbers, short excerpts with secrets masked, and the names of the settings your code reads. It never keeps their values.",
            "Keys you give birdsI for your vendor accounts are stored encrypted and used only to read those accounts.",
            "No AI model reads your code to make the map. The optional docs check sends the lines around a package's import to an AI model provider. Nothing is used to train models.",
            "You can disconnect a repository or delete everything from Settings at any time.",
          ]}
        />
      </LegalSection>

      <LegalSection title="What birdsI stores">
        <LegalList
          items={[
            <>
              <b>Your account.</b> Your GitHub username and user id, the email address on your GitHub account, and whether you want alerts by email. birdsI sends no email yet. Sign-in itself is handled by Clerk.
            </>,
            <>
              <b>Apps and repositories you connect.</b> Their names, default branches, and the GitHub App installation that grants read access.
            </>,
            <>
              <b>The map of each app.</b> The services and packages the code uses, the names of the settings (environment variables) it reads, its crons, webhooks, store apps, migrations and public pages, each with the file and line it came from. Findings from the checks, with short code excerpts as evidence and secrets masked.
            </>,
            <>
              <b>What the accounts say.</b> With a key you connect: deployments and their state, the names of the settings each project has (never their values), whether a database is paused, its advisor warnings and size, push subscriber and delivery counts. Each reading is dated and kept with the address it came from.
            </>,
            <>
              <b>The record.</b> Decisions, facts, approvals, questions and answers written by you or your coding agent, and the vision you write for an app.
            </>,
            <>
              <b>Usage records.</b> Which AI model was called for the docs check, how much text it read and wrote, and when. These enforce the daily limits.
            </>,
            <>
              <b>Keys and tokens.</b> Terminal and MCP tokens are stored only as one-way hashes. Vendor account keys you connect are stored encrypted on birdsI&apos;s servers.
            </>,
            <>
              <b>Sign-in starts.</b> A one-way hash of the network address and browser name, to limit how often a terminal sign-in can be started.
            </>,
            <>
              <b>From before 18 October 2026.</b> Chat messages, code passages indexed for chat, proposed fixes and pull request details stay in the database from when birdsI had them. Nothing reads them now, and they are deleted with the repository or your account.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="How long it is kept">
        <LegalList
          items={[
            "Code uploaded by the terminal tool is deleted as soon as its map has run, and within a day if the map never starts. Code fetched from GitHub lives only for the duration of the map.",
            "Maps, findings, readings, the record and your keys are kept until you disconnect the repository or delete your account.",
            "Usage records are kept for cost accounting. When you delete your account they stay, without your name or email, tied only to your sign-in account number, so the daily limits still count them if you sign in again.",
            "Backups made by the database host roll off within their own retention window after deletion.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Who else processes your data">
        <LegalP>birdsI uses these services to run. Each receives only what it needs.</LegalP>
        <LegalList
          items={[
            <>
              <b>Vendors you connect</b>, such as Vercel, Supabase and OneSignal, receive read requests made with your key.
            </>,
            <>
              <b>Anthropic</b> runs the Claude model behind the optional docs check. It receives a few lines of code around where a package is imported, and pages of that package&apos;s own documentation. <b>Tavily</b> finds those pages, from search queries built from package names, not your source files.
            </>,
            <>
              <b>OSV</b> and <b>deps.dev</b> receive the names and versions of your packages, to check them for known problems. The <b>npm</b>, <b>PyPI</b> and <b>crates.io</b> registries receive package names, to look up their latest versions.
            </>,
            <>
              <b>GitHub</b> provides the code through the birdsI GitHub App, which only reads.
            </>,
            <>
              <b>Clerk</b> handles sign-in. <b>Supabase</b> hosts the database and the short-lived uploads. <b>Vercel</b> hosts the website and <b>Railway</b> runs the worker.
            </>,
          ]}
        />
        <LegalP>Your code is never used to train AI models. birdsI does not sell or share personal information for advertising.</LegalP>
      </LegalSection>

      <LegalSection title="GitHub App permissions">
        <LegalList
          items={[
            "Read access to code and metadata, only in the repositories you choose on GitHub. birdsI never writes to a repository.",
            "You can change which repositories birdsI can read, or remove it entirely, in your GitHub settings under Applications.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Deleting your data">
        <LegalP>
          In <Link href="/settings">Settings</Link> you can disconnect a repository, remove a vendor key, revoke terminal and MCP tokens, and delete your account. Deleting your account removes your apps, maps, findings, readings, keys, record and tokens and disconnects every repository. Usage records remain without your name or email, so the daily limits still count them if you sign in again.
        </LegalP>
      </LegalSection>

      <LegalSection title="Security">
        <LegalP>Data travels encrypted. Tokens are stored as hashes and vendor keys encrypted. Secrets found in your code are masked before any excerpt is saved, and birdsI never asks a vendor for the value of a setting.</LegalP>
      </LegalSection>

      <LegalSection title="Age">
        <LegalP>birdsI is for people aged 16 and over. It does not knowingly collect information from anyone younger. If you believe a younger person has an account, contact the operator and it will be deleted.</LegalP>
      </LegalSection>

      <LegalSection title="Your rights in California and elsewhere">
        <LegalP>
          You can ask what personal information birdsI holds about you, ask for a copy, ask for it to be corrected, or ask for it to be deleted. Most of this you can do yourself in Settings. birdsI does not sell personal information and does not share it for cross-context advertising. Using these rights never changes the service you get.
        </LegalP>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <LegalP>
          If this policy changes in a way that matters, the new version is posted here with a new date before it takes effect. To ask a question or make a request, contact the operator on GitHub,{" "}
          <a href={OPERATOR_URL} style={{ color: "var(--text)" }}>
            @{OPERATOR_NAME}
          </a>
          .
        </LegalP>
      </LegalSection>
    </LegalPage>
  );
}
