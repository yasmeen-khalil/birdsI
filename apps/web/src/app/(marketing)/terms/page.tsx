import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalP, LegalPage, LegalSection } from "@/components/marketing/Legal";
import { GITHUB_REPO_URL } from "@/components/marketing/SiteChrome";

/** Replace with the legal name of the person or company that runs this instance of birdsI. */
const OPERATOR_NAME = "{{OPERATOR_NAME}}";
const EFFECTIVE_DATE = "28 September 2026";
const SECURITY_POLICY_URL = `${GITHUB_REPO_URL}/security/policy`;

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      effective={EFFECTIVE_DATE}
      intro={
        <>
          These terms cover the hosted birdsI service: this website, its terminal tool sign-in, and its MCP server. birdsI is run by {OPERATOR_NAME} (“the operator”). By signing in or using the service you agree to them.
        </>
      }
    >
      <LegalSection title="Who can use birdsI">
        <LegalP>You must be at least 16 years old. If you use birdsI for a company or other organisation, you confirm you may accept these terms for it.</LegalP>
      </LegalSection>

      <LegalSection title="What birdsI does">
        <LegalP>
          birdsI reads the code in repositories you connect, finds the outside services (vendors) it runs on, checks the code against current documentation and vulnerability databases, and reports what it finds. With accounts you connect, it reads plans, usage, limits and spend. For some findings it writes a fix, tests it on a separate copy, and opens a pull request. For others it gives you steps to follow.
        </LegalP>
        <LegalP>Every finding says how sure birdsI is: Proven, Doc-verified, or Judgment. Judgment findings are an AI model’s reading of your code and may be wrong.</LegalP>
      </LegalSection>

      <LegalSection title="Your code stays yours">
        <LegalList
          items={[
            "You keep every right to your code. You give the operator permission to copy, process and store it only as needed to run the service for you, as described in the privacy policy.",
            "Only connect repositories you have the right to share with a service like birdsI.",
            "Your code is never used to train AI models without your opt-in.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Fixes and pull requests">
        <LegalP>
          A fix is a proposal. birdsI opens it as a pull request on a new branch and never merges it or pushes to your main branch. You decide whether to merge, and you are responsible for reviewing the change first. A passing test lowers the risk of a broken change but does not remove it. Commands a coding agent or birdsI proposes run only after you approve them, on your own computer, and you are responsible for what they do, including plan changes and charges.
        </LegalP>
      </LegalSection>

      <LegalSection title="Fair use">
        <LegalList
          items={[
            "Do not use birdsI to attack, probe or scan systems or code you do not own or have permission to test.",
            "Do not try to get around scan limits, share accounts to avoid them, or overload the sample scan.",
            "Do not use the service to build a competing dataset of other people’s findings.",
          ]}
        />
        <LegalP>The operator may limit, pause or end access for anyone who breaks these rules or puts the service or other users at risk.</LegalP>
      </LegalSection>

      <LegalSection title="Open source">
        <LegalP>
          The birdsI source code is published under the Mozilla Public License 2.0, and that license governs the code. These terms govern the hosted service only. The birdsI name and mark are not licensed by either.
        </LegalP>
      </LegalSection>

      <LegalSection title="Your account">
        <LegalP>
          You sign in with GitHub and are responsible for what happens under your account and your terminal and MCP tokens. You can delete your account at any time in <Link href="/settings">Settings</Link>.
        </LegalP>
      </LegalSection>

      <LegalSection title="No warranty">
        <LegalP>
          birdsI is provided as it is. It will miss some problems and may report some that are not real. It is not a substitute for your own review, a professional security audit, or legal advice. To the extent the law allows, the operator makes no warranties, express or implied, including fitness for a particular purpose.
        </LegalP>
      </LegalSection>

      <LegalSection title="Limits on liability">
        <LegalP>
          To the extent the law allows, the operator is not liable for indirect, incidental or consequential losses, lost profits, or lost data arising from the service, and its total liability for any claim is limited to the amount you paid for the service in the twelve months before the claim, or 50 US dollars if you paid nothing.
        </LegalP>
      </LegalSection>

      <LegalSection title="Law and changes">
        <LegalP>These terms are governed by the laws of the State of California, without regard to its conflict of law rules. Disputes go to the state or federal courts located in California.</LegalP>
        <LegalP>If these terms change in a way that matters, the new version is posted here with a new date before it takes effect. Continuing to use birdsI after that means you accept the new terms.</LegalP>
      </LegalSection>

      <LegalSection title="Contact">
        <LegalP>
          Reach the operator through the{" "}
          <a href={SECURITY_POLICY_URL} style={{ color: "var(--text)" }}>
            security policy of the birdsI repository on GitHub
          </a>
          .
        </LegalP>
      </LegalSection>
    </LegalPage>
  );
}
