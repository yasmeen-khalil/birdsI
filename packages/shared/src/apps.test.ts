import { describe, expect, it } from "vitest";
import { PROJECT_VENDORS, projectDashboardUrl, projectProblem } from "./apps";

describe("projects", () => {
  it("accepts the ids each vendor really uses, and explains a wrong one", () => {
    expect(projectProblem({ vendor: "supabase", kind: "project", ref: "abcdefghijklmnopqrst", settings: {} })).toBeNull();
    expect(projectProblem({ vendor: "supabase", kind: "project", ref: "https://abc.supabase.co", settings: {} })).toMatch(/does not look like a Supabase project ref/);
    expect(projectProblem({ vendor: "onesignal", kind: "app", ref: "0f8e2c1a-1234-4abc-9def-0123456789ab", settings: {} })).toBeNull();
    expect(projectProblem({ vendor: "vercel", kind: "project", ref: "flowsophy-ops", settings: {} })).toBeNull();
    expect(projectProblem({ vendor: "vercel", kind: "team", ref: "flowsophy", settings: {} })).toMatch(/team id/);
    expect(projectProblem({ vendor: "apple", kind: "app", ref: "6745532104", settings: {} })).toBeNull();
    expect(projectProblem({ vendor: "nope", kind: "app", ref: "x", settings: {} })).toMatch(/does not know/);
    expect(projectProblem({ vendor: "supabase", kind: "app", ref: "x", settings: {} })).toMatch(/has no app/);
  });

  it("links each project to its own place in the vendor's dashboard", () => {
    expect(projectDashboardUrl({ vendor: "supabase", kind: "project", ref: "abcdefghijklmnopqrst", settings: {} })).toBe("https://supabase.com/dashboard/project/abcdefghijklmnopqrst");
    expect(projectDashboardUrl({ vendor: "onesignal", kind: "app", ref: "0f8e2c1a-1234-4abc-9def-0123456789ab", settings: {} })).toBe("https://dashboard.onesignal.com/apps/0f8e2c1a-1234-4abc-9def-0123456789ab");
    expect(projectDashboardUrl({ vendor: "vercel", kind: "project", ref: "flowsophy-ops", settings: { team: "owner-team" } })).toBe("https://vercel.com/owner-team/flowsophy-ops");
    expect(projectDashboardUrl({ vendor: "vercel", kind: "project", ref: "flowsophy-ops", settings: { team: "team_abc" } })).toBe("https://vercel.com/dashboard");
  });

  it("names a key for every vendor it reads, and none for the rest", () => {
    for (const v of PROJECT_VENDORS) {
      if (v.reads) expect(v.keyHint.length, v.vendor).toBeGreaterThan(10);
      else expect(v.keyHint, v.vendor).toBe("");
    }
  });
});
