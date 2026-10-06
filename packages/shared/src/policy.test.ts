import { describe, expect, it } from "vitest";
import { accountChange, checkCommand, normalizeCommand } from "./policy";

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
});
