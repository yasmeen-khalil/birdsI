import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { walkInventory } from "../inventory/walk";
import { discoverVendors } from "./discover";

let root: string;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "birdsi-vendors-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("discoverVendors", () => {
  it("finds vendors from packages, env names, URLs and config files", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ name: "app", dependencies: { "@supabase/supabase-js": "^2", stripe: "^14" } }),
      ".env.example": "SUPABASE_URL=\nSUPABASE_SECRET_KEY=\nSUPADATA_API_KEY=\nDATABASE_URL=\n",
      "src/transcript.ts": 'const key = process.env.SUPADATA_API_KEY;\nawait fetch("https://api.supadata.ai/v1/youtube/transcript?url=" + url, { headers: { "x-api-key": key } });\n',
      "vercel.json": "{}",
    });
    const inventory = await walkInventory(dir);
    const vendors = await discoverVendors(
      inventory,
      [
        { ecosystem: "npm", name: "@supabase/supabase-js", version: "2.0.0", declared: "^2", manifestPath: "package.json", direct: true },
        { ecosystem: "npm", name: "stripe", version: "14.0.0", declared: "^14", manifestPath: "package.json", direct: true },
      ],
      null,
    );
    const slugs = vendors.map((v) => v.slug).sort();
    expect(slugs).toEqual(["stripe", "supabase", "supadata", "vercel"]);
    const supabase = vendors.find((v) => v.slug === "supabase")!;
    expect(supabase.detectedBy).toEqual(expect.arrayContaining(["package", "env"]));
    expect(supabase.connectable).toBe(true);
    const supadata = vendors.find((v) => v.slug === "supadata")!;
    expect(supadata.envVars).toContain("SUPADATA_API_KEY");
    expect(supadata.callSites.some((c) => c.path === "src/transcript.ts")).toBe(true);
    expect(supadata.detectedBy).toEqual(expect.arrayContaining(["env", "url"]));
    const vercel = vendors.find((v) => v.slug === "vercel")!;
    expect(vercel.detectedBy).toContain("config");
  });

  it("names unknown vendors from their env var and ignores generic names", async () => {
    const dir = await fixture({
      "app.py": 'import os\nkey = os.environ["ACME_WEATHER_API_KEY"]\nsecret = os.getenv("JWT_SECRET")\ng = os.getenv("GOOGLE_IOS_CLIENT_ID")\ns = os.getenv("STUDENT_SESSION_SECRET")\no = os.getenv("OPS_SECRET")\n',
    });
    const inventory = await walkInventory(dir);
    const vendors = await discoverVendors(inventory, [], null);
    expect(vendors.map((v) => v.slug)).toEqual(["acme-weather"]);
    expect(vendors[0]!.name).toBe("Acme Weather");
    expect(vendors[0]!.what).toBe("");
    expect(vendors[0]!.connectable).toBe(false);
  });

  it("reads services from Stripe Projects hints", async () => {
    const dir = await fixture({ "index.js": "console.log(1)\n" });
    const inventory = await walkInventory(dir);
    const vendors = await discoverVendors(inventory, [], { stripeProjects: { state: { services: [{ provider: "supabase/postgres" }, { provider: "resend" }] }, collectedAt: new Date().toISOString() } });
    expect(vendors.map((v) => v.slug).sort()).toEqual(["resend", "supabase"]);
    expect(vendors.every((v) => v.detectedBy.includes("projects"))).toBe(true);
  });
});
