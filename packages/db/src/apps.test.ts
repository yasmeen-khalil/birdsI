import { afterEach, describe, expect, it } from "vitest";
import { keyFingerprint, toApp, type AppProjectRow, type AppRow, type ProjectConnectionRow } from "./apps";

const app: AppRow = { id: "a", owner_user_id: "u", repo_id: "r", name: "Flowsophy", environments: ["production"], created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" };
const project = (id: string, label: string): AppProjectRow => ({ id, app_id: "a", vendor: "vercel", kind: "project", ref: label, label, environment: "production", plan: null, settings: {}, created_at: "2026-10-18T00:00:00Z" });
const key = (id: string, projectId: string, fingerprint: string): ProjectConnectionRow => ({
  id,
  owner_user_id: "u",
  vendor_slug: "vercel",
  label: null,
  token_ciphertext: "v1.secret.secret.secret",
  settings: {},
  last_probed_at: null,
  last_status: "ok",
  last_error: null,
  created_at: "2026-10-18T00:00:00Z",
  app_id: "a",
  app_project_id: projectId,
  key_fingerprint: fingerprint,
  scope: "read",
});

afterEach(() => {
  delete process.env["BIRDSI_SECRETS_KEY"];
});

describe("keys as the page sees them", () => {
  it("fingerprints a key the same way every time, and differently under another secret", () => {
    process.env["BIRDSI_SECRETS_KEY"] = "one-long-random-server-secret";
    const a = keyFingerprint("vercel_token_value");
    expect(a).toBe(keyFingerprint("vercel_token_value"));
    expect(a).not.toBe(keyFingerprint("another_token_value"));
    process.env["BIRDSI_SECRETS_KEY"] = "a-different-server-secret-here";
    expect(keyFingerprint("vercel_token_value")).not.toBe(a);
  });

  it("says which projects share a key, and never carries the key itself", () => {
    const shaped = toApp(app, [project("p1", "product"), project("p2", "ops"), project("p3", "schools")], [key("k1", "p1", "abcdef123456"), key("k2", "p2", "abcdef123456"), key("k3", "p3", "999999999999")]);
    const product = shaped.projects.find((p) => p.id === "p1")!;
    expect(product.key?.sharedWith).toEqual(["Vercel ops"]);
    expect(product.key?.fingerprint).toBe("abcdef");
    expect(shaped.projects.find((p) => p.id === "p3")!.key?.sharedWith).toEqual([]);
    expect(JSON.stringify(shaped)).not.toContain("v1.secret");
  });
});
