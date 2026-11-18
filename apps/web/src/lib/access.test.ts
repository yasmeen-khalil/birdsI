import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "@birdsi/db";
import { hasAccess, isOwner, ownerIds } from "./access";

const base: UserRow = {
  id: "11111111-1111-4111-8111-111111111111",
  clerk_user_id: "user_1",
  github_login: "someone",
  github_user_id: 42,
  email: "someone@example.com",
  email_updates: false,
  created_at: "2026-11-17T00:00:00.000Z",
  deleted_at: null,
  access: "pending",
  access_requested_at: null,
  access_decided_at: null,
};

describe("access by approval", () => {
  it("lets in an approved account and nobody else", () => {
    expect(hasAccess({ ...base, access: "approved" }, "")).toBe(true);
    expect(hasAccess({ ...base, access: "pending" }, "")).toBe(false);
    const asked: UserRow = { ...base, access: "pending", access_requested_at: "2026-11-17T00:00:00.000Z" };
    expect(hasAccess(asked, "")).toBe(false);
    expect(hasAccess({ ...base, access: "denied" }, "")).toBe(false);
  });

  it("refuses a row it cannot read as approved", () => {
    // A database without the access column returns rows with no access at all.
    expect(hasAccess({ ...base, access: undefined as unknown as UserRow["access"] }, "")).toBe(false);
    expect(hasAccess({ ...base, access: "APPROVED" as unknown as UserRow["access"] }, "")).toBe(false);
    expect(hasAccess({ ...base, access: "approved", deleted_at: "2026-11-17T00:00:00.000Z" }, "")).toBe(false);
  });

  it("knows the owner by GitHub id only", () => {
    expect(isOwner(base, "42")).toBe(true);
    expect(isOwner(base, " 7, 42 ,9")).toBe(true);
    expect(isOwner(base, "420")).toBe(false);
    expect(isOwner(base, "")).toBe(false);
    expect(isOwner(base, undefined)).toBe(false);
    expect(isOwner({ ...base, github_user_id: null }, "42")).toBe(false);
    expect(isOwner({ ...base, github_user_id: null }, "null")).toBe(false);
    expect(isOwner({ ...base, deleted_at: "2026-11-17T00:00:00.000Z" }, "42")).toBe(false);
    // A login is never an id: a list of names names nobody.
    expect(ownerIds("someone, 42x, -1").size).toBe(0);
  });

  it("never locks the owner out, and gives a denied owner id nothing extra", () => {
    expect(hasAccess({ ...base, access: "pending" }, "42")).toBe(true);
    expect(hasAccess({ ...base, access: "denied", github_user_id: 43 }, "42")).toBe(false);
  });
});

const state = vi.hoisted(() => ({ session: null as UserRow | null, tokenUser: null as UserRow | null }));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }), currentUser: async () => null }));
vi.mock("./auth", () => ({ signedInUserUngated: async () => state.session }));
vi.mock("@birdsi/db", async () => {
  class NotFoundError extends Error {}
  class ForbiddenError extends Error {}
  return {
    NotFoundError,
    ForbiddenError,
    userIdForToken: async (token: string) => (token === "good" && state.tokenUser ? state.tokenUser.id : null),
    userById: async () => state.tokenUser,
  };
});

describe("the API door", () => {
  beforeEach(() => {
    state.session = null;
    state.tokenUser = null;
    delete process.env["BIRDSI_OWNER_GITHUB_IDS"];
  });

  async function call(headers: Record<string, string> = {}): Promise<{ status: number; code?: string; id?: string }> {
    const { requireCaller, errorResponse } = await import("./api");
    try {
      const user = await requireCaller(new Request("https://birdsi.test/api/v1/me", { headers }));
      return { status: 200, id: user.id };
    } catch (error) {
      const response = errorResponse(error);
      const body = (await response.json()) as { error: { code: string } };
      return { status: response.status, code: body.error.code };
    }
  }

  it("answers 401 with no session and no token", async () => {
    expect(await call()).toEqual({ status: 401, code: "unauthorized" });
  });

  it("refuses a session that is pending or denied", async () => {
    state.session = { ...base, access: "pending" };
    expect(await call()).toEqual({ status: 403, code: "pending_approval" });
    state.session = { ...base, access: "pending", access_requested_at: "2026-11-17T00:00:00.000Z" };
    expect(await call()).toEqual({ status: 403, code: "pending_approval" });
    state.session = { ...base, access: "denied" };
    expect(await call()).toEqual({ status: 403, code: "pending_approval" });
  });

  it("refuses a valid token whose account is not approved, so removing access cuts the terminal and the agent off too", async () => {
    state.tokenUser = { ...base, access: "denied" };
    expect(await call({ authorization: "Bearer good" })).toEqual({ status: 403, code: "pending_approval" });
    state.tokenUser = { ...base, access: "pending" };
    expect(await call({ authorization: "Bearer good" })).toEqual({ status: 403, code: "pending_approval" });
  });

  it("lets an approved session and an approved token through", async () => {
    state.session = { ...base, access: "approved" };
    expect(await call()).toEqual({ status: 200, id: base.id });
    state.session = null;
    state.tokenUser = { ...base, access: "approved" };
    expect(await call({ authorization: "Bearer good" })).toEqual({ status: 200, id: base.id });
    expect(await call({ authorization: "Bearer bad" })).toEqual({ status: 401, code: "unauthorized" });
  });
});

function files(dir: string, name: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path, name);
    return name.test(entry) ? [path] : [];
  });
}

describe("every door is behind the gate", () => {
  const src = resolve(import.meta.dirname, "..");

  it("every page of the app resolves an approved account first", () => {
    const pages = files(join(src, "app/(app)"), /^page\.tsx$/);
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) {
      expect(/\b(appUser|repoContext)\(/.test(readFileSync(page, "utf8")), page).toBe(true);
    }
  });

  it("every API route resolves its caller through the gate, or is one of the named exceptions", () => {
    // Each exception authenticates another way and hands nothing of an account to a caller without access.
    const exceptions = new Map<string, RegExp>([
      ["app/api/github/webhook/route.ts", /verifyWebhookSignature|signature/i],
      ["app/api/cron/sync/route.ts", /CRON_SECRET/],
      ["app/api/v1/device/start/route.ts", /allowDeviceStart/],
      ["app/api/v1/device/poll/route.ts", /pollDeviceLogin/],
      ["app/api/v1/actions/[actionId]/decide/route.ts", /currentUserRow\(/],
      ["app/github/setup/route.ts", /currentUserRow\(/],
    ]);
    const routes = [...files(join(src, "app/api"), /^route\.ts$/), ...files(join(src, "app/github"), /^route\.ts$/)];
    expect(routes.length).toBeGreaterThan(30);
    for (const route of routes) {
      const text = readFileSync(route, "utf8");
      const rel = route.slice(src.length + 1);
      const exception = exceptions.get(rel);
      if (exception) expect(exception.test(text), rel).toBe(true);
      else expect(/requireCaller\(/.test(text), rel).toBe(true);
    }
  });

  it("only the gate itself reads an account that is not approved", () => {
    const allowed = new Set(["lib/auth.ts", "lib/api.ts", "lib/actions.ts", "lib/access.test.ts", "components/server/data.ts", "app/(marketing)/pending/page.tsx"]);
    for (const file of files(src, /\.tsx?$/)) {
      const rel = file.slice(src.length + 1);
      if (allowed.has(rel)) continue;
      expect(readFileSync(file, "utf8").includes("signedInUserUngated"), rel).toBe(false);
    }
  });

  it("every server action but the two for an account without access needs an approved account", () => {
    const text = readFileSync(join(src, "lib/actions.ts"), "utf8");
    const actions = text.split(/\nexport async function /).slice(1);
    expect(actions.length).toBeGreaterThan(20);
    for (const action of actions) {
      const name = action.slice(0, action.indexOf("("));
      if (name === "requestAccessAction" || name === "withdrawRequestAction") {
        expect(action.includes("signedInUserUngated()"), name).toBe(true);
        continue;
      }
      expect(action.includes("requireUser()"), name).toBe(true);
    }
  });
});
