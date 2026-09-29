import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalP, LegalPage, LegalSection } from "@/components/marketing/Legal";
import { GITHUB_REPO_URL } from "@/components/marketing/SiteChrome";

/** Replace with the legal name of the person or company that runs this instance of birdsI. */
const OPERATOR_NAME = "{{OPERATOR_NAME}}";
const EFFECTIVE_DATE = "28 September 2026";
const SECURITY_POLICY_URL = `${GITHUB_REPO_URL}/security/policy`;

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      effective={EFFECTIVE_DATE}
      intro={
        <>
          birdsI reads code so it can find problems in it. This policy says what it keeps, for how long, who else processes it, and how you remove it. birdsI is run by {OPERATOR_NAME} (“the operator”).
        </>
      }
    >
      <LegalSection title="The short version">
        <LegalList
          items={[
            "A copy of your code exists only while a scan runs, then it is deleted.",
            "Findings, dependency lists and chats are kept until you delete your account.",
            "Your code is sent to Nebius Token Factory to be read by AI models, and search queries about your packages go to Tavily. Your code is never used to train models unless you opt in, and birdsI offers no such opt-in today.",
            "You can disconnect a repository or delete everything from Settings at any time.",
          ]}
        />
      </LegalSection>

      <LegalSection title="What birdsI stores">
        <LegalList
          items={[
            <>
              <b>Your account.</b> Your GitHub username and user id, the email address on your GitHub account, and whether you want email updates. Sign-in itself is handled by Clerk.
            </>,
            <>
              <b>Repositories you connect.</b> Their names, default branches, and the GitHub App installation that grants access.
            </>,
            <>
              <b>Repository snapshots.</b> A copy of the repository, fetched from GitHub or uploaded by the birdsI terminal tool, used only for the duration of a scan or a fix.
            </>,
            <>
              <b>Findings and scan results.</b> Each finding’s title, explanation, file path and line, and a short code excerpt as evidence, with secrets masked. Also the scan’s progress log, summary, and pre-launch audit report.
            </>,
            <>
              <b>Dependency lists.</b> The packages your code uses, their versions, known problems and documentation checks.
            </>,
            <>
              <b>Chat.</b> Your questions and birdsI’s answers, and short passages of your code indexed so chat can find the right files.
            </>,
            <>
              <b>Fixes.</b> The change birdsI proposed, the output of the sandbox test, and the pull request it opened.
            </>,
            <>
              <b>Usage records.</b> Which AI models were called for you, how much text they read and wrote, and when. These enforce fair-use limits.
            </>,
            <>
              <b>Terminal and MCP tokens.</b> Stored only as one-way hashes, with their name and when they were last used.
            </>,
            <>
              <b>Sample scans.</b> Visitors who try the sample are not asked to sign in. birdsI keeps a one-way hash of the network address and browser name for an hour, to limit how often the sample runs.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="How long it is kept">
        <LegalList
          items={[
            "Repository snapshots are deleted as soon as the scan or fix that needed them ends, whether it finished, failed or was stopped.",
            "Findings, scan results, dependency lists, chats and fixes are kept until you delete your account. Disconnecting a repository stops birdsI from reading it; its earlier results stay until your account is deleted.",
            "Usage records are kept for cost accounting. When you delete your account they stay without anything that identifies you.",
            "Indexed code passages for chat are replaced on every scan and deleted with the repository or your account.",
            "Backups made by the database host roll off within their own retention window after deletion.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Who else processes your data">
        <LegalP>birdsI uses these services to run. Each receives only what it needs.</LegalP>
        <LegalList
          items={[
            <>
              <b>Nebius Token Factory</b> runs the AI models (NVIDIA Nemotron) that read your code, write fixes and answer chat. It receives the code passages being read.
            </>,
            <>
              <b>Nebius sandboxes</b> run your project’s build and tests on a proposed fix before a pull request opens. They receive a copy of the repository for that test.
            </>,
            <>
              <b>Tavily</b> searches current documentation. It receives search queries built from your package names and versions, not your source files.
            </>,
            <>
              <b>LangSmith</b>, when enabled by the operator, records model calls, including the passages sent, to measure how accurate findings are.
            </>,
            <>
              <b>GitHub</b> provides the code through the birdsI GitHub App and receives the pull requests you ask for.
            </>,
            <>
              <b>Clerk</b> handles sign-in. <b>Supabase</b> hosts the database. <b>Vercel</b> hosts the website.
            </>,
          ]}
        />
        <LegalP>Your code is never used to train AI models without your opt-in. birdsI does not sell or share personal information for advertising.</LegalP>
      </LegalSection>

      <LegalSection title="GitHub App permissions">
        <LegalList
          items={[
            "Read access to code and metadata, only in the repositories you choose on GitHub.",
            "Write access to pull requests and to new branches, so a fix can be opened as a pull request. birdsI never merges a pull request and never pushes to your main branch.",
            "You can change which repositories birdsI can read, or remove it entirely, in your GitHub settings under Applications.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Deleting your data">
        <LegalP>
          In <Link href="/settings">Settings</Link> you can disconnect a repository, revoke terminal and MCP tokens, turn off email updates, and delete your account. Deleting your account removes your findings, scans, chats, fixes and tokens and disconnects every repository. Usage records remain only as anonymous totals. Pull requests birdsI opened stay on GitHub, because they belong to your repository.
        </LegalP>
      </LegalSection>

      <LegalSection title="Security">
        <LegalP>Data travels encrypted. Tokens are stored as hashes. Secrets found in your code are masked before any excerpt is saved. If you find a security problem in birdsI, report it privately through the security policy below.</LegalP>
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
          If this policy changes in a way that matters, the new version is posted here with a new date before it takes effect. To ask a question or make a request, contact the operator through the{" "}
          <a href={SECURITY_POLICY_URL} style={{ color: "var(--text)" }}>
            security policy of the birdsI repository on GitHub
          </a>
          .
        </LegalP>
      </LegalSection>
    </LegalPage>
  );
}
