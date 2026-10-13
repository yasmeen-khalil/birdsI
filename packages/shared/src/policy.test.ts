import { describe, expect, it } from "vitest";
import { accountChange, checkCommand, commandSegments, normalizeCommand } from "./policy";

describe("policy hook", () => {
  it("lets reads, status and local work through", () => {
    for (const c of ["vercel env ls", "stripe projects status", "supabase db diff", "railway logs", "npm run build", "git push origin main", "gh pr create --fill", "fly status"]) {
      expect(checkCommand(c, null).verdict, c).toBe("allow");
    }
  });

  it("sends account changes through birdsI", () => {
    for (const c of ["stripe projects upgrade vercel pro", "vercel env add STRIPE_KEY production", "supabase projects pause", "railway variables set X=1", "fly scale count 2", "gh secret set TOKEN", "npm publish --access public"]) {
      const v = checkCommand(c, { allowPropose: true });
      expect(v.verdict, c).toBe("propose");
      expect(v.reason).toContain("birdsi_request_action");
    }
  });

  it("reads through npx and dlx and names the vendor", () => {
    expect(normalizeCommand("  npx  -y vercel   promote abc ")).toBe("vercel promote abc");
    expect(accountChange("pnpm dlx supabase link --project-ref x")).toBe("Supabase");
    expect(accountChange("bunx stripe projects limit set 100")).toBe("Stripe");
  });

  it("changes the wording when agents may not propose", () => {
    const v = checkCommand("vercel rollback", { allowPropose: false });
    expect(v.verdict).toBe("propose");
    expect(v.reason).toContain("may not propose");
  });

  it("checks every command in a shell line, not only the first", () => {
    expect(accountChange("cd app && vercel env add KEY production")).toBe("Vercel");
    expect(accountChange("npm run build; npm publish")).toBe("npm");
    expect(accountChange("git pull || supabase db push")).toBe("Supabase");
    expect(accountChange("echo ok | gh secret set TOKEN")).toBe("GitHub");
    expect(accountChange("(cd infra && fly deploy)")).toBe("Fly.io");
    expect(accountChange('bash -c "cd app && vercel env rm KEY"')).toBe("Vercel");
    expect(accountChange("echo $(railway up)")).toBe("Railway");
  });

  it("sees through env, VAR=value, sudo and paths to the binary", () => {
    expect(accountChange("env X=1 vercel env add KEY")).toBe("Vercel");
    expect(accountChange("VERCEL_ORG_ID=x VERCEL_PROJECT_ID=y vercel promote abc")).toBe("Vercel");
    expect(accountChange("sudo -u deploy flyctl secrets set A=1")).toBe("Fly.io");
    expect(accountChange("./node_modules/.bin/vercel env add KEY")).toBe("Vercel");
    expect(accountChange("yarn vercel env add KEY")).toBe("Vercel");
    expect(accountChange("pnpm exec supabase db reset")).toBe("Supabase");
  });

  it("skips global flags before the subcommand", () => {
    expect(accountChange("vercel --cwd . env add KEY")).toBe("Vercel");
    expect(accountChange("vercel --token abc --scope team env rm KEY")).toBe("Vercel");
    expect(accountChange("gh -R owner/repo secret set TOKEN")).toBe("GitHub");
    expect(accountChange("stripe --api-key sk projects upgrade vercel pro")).toBe("Stripe");
    expect(accountChange("npm --prefix packages/cli publish")).toBe("npm");
  });

  it("treats production deploys as account changes and previews as local work", () => {
    expect(accountChange("vercel --prod")).toBe("Vercel");
    expect(accountChange("vercel deploy --prod")).toBe("Vercel");
    expect(accountChange("npx vercel deploy --prebuilt --prod")).toBe("Vercel");
    expect(accountChange("vercel deploy --target production")).toBe("Vercel");
    expect(accountChange("vercel deploy --target=production")).toBe("Vercel");
    expect(accountChange("vercel")).toBeNull();
    expect(accountChange("vercel deploy")).toBeNull();
  });

  it("still lets harmless lines through", () => {
    for (const c of ["cd app && npm run build", "vercel env ls && vercel logs", 'echo "vercel env add" > notes.txt', "git commit -m 'npm publish later'"]) {
      expect(accountChange(c), c).toBeNull();
    }
  });

  it("splits on shell operators outside quotes only", () => {
    expect(commandSegments('echo "a && b"; ls')).toEqual(['echo "a && b"', "ls"]);
  });
});
