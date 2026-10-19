import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalP, LegalPage, LegalSection } from "@/components/marketing/Legal";

/** Who runs this instance of birdsI. A self-hosted copy names its own operator here. */
const OPERATOR_NAME = "yasmeen-khalil";
const OPERATOR_URL = "https://github.com/yasmeen-khalil";
const EFFECTIVE_DATE = "18 October 2026";

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
          birdsI maps the code of the apps you connect: the outside services (vendors) each one runs on, its deployments, crons, webhooks, store apps, migrations and the names of the settings it needs. It checks the code against vulnerability databases and, when set up, against each main package&apos;s own current documentation. With keys you give it for your vendor accounts, it reads status, plans and usage, and turns what goes wrong into alerts. It writes no code and opens no pull requests.
        </LegalP>
        <LegalP>Every finding says how sure birdsI is: Proven, Doc-verified, or Judgment. Judgment findings were an AI model&apos;s reading of your code, kept from before birdsI stopped reading code with a model, and may be wrong.</LegalP>
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

      <LegalSection title="Keys and approvals">
        <LegalP>
          Give birdsI keys that only read wherever the vendor offers them. Some vendors offer no key that only reads, and birdsI uses those keys for reads alone. Nothing a coding agent or birdsI proposes runs until it is approved, by you or by the rule you set. Commands run on your own computer, and you are responsible for what they do, including plan changes and charges.
        </LegalP>
      </LegalSection>

      <LegalSection title="Fair use">
        <LegalList
          items={[
            "Do not use birdsI to attack, probe or scan systems or code you do not own or have permission to test.",
            "Do not try to get around the limits on maps, or share accounts to avoid them.",
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
          Reach the operator on GitHub,{" "}
          <a href={OPERATOR_URL} style={{ color: "var(--text)" }}>
            @{OPERATOR_NAME}
          </a>
          .
        </LegalP>
      </LegalSection>
    </LegalPage>
  );
}
