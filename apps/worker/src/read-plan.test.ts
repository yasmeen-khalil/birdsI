import { describe, expect, it } from "vitest";
import { planReads, type PlanProject } from "./read-plan";

const vendors = [
  { id: "v1", slug: "vercel" },
  { id: "v2", slug: "supabase" },
  { id: "v3", slug: "clerk" },
];
const projects: PlanProject[] = [
  { id: "p1", vendor: "vercel", kind: "project", ref: "flowsophy", label: "product", settings: { team: "team_1" } },
  { id: "p2", vendor: "vercel", kind: "project", ref: "flowsophy-ops", label: "ops", settings: { team: "team_1" } },
  { id: "p3", vendor: "supabase", kind: "project", ref: "abcdefghijklmnopqrst", label: null, settings: {} },
];
const readable = (slug: string) => slug !== "clerk";

describe("planReads", () => {
  it("reads each tied project with its own key, labelled when a vendor has several", () => {
    const plan = planReads(vendors, projects, [
      { id: "k1", vendor_slug: "vercel", app_project_id: "p1" },
      { id: "k2", vendor_slug: "vercel", app_project_id: "p2" },
      { id: "k3", vendor_slug: "supabase", app_project_id: "p3" },
    ], [], readable);
    expect(plan.map((t) => [t.connectionId, t.suffix])).toEqual([
      ["k1", "product"],
      ["k2", "ops"],
      ["k3", null],
    ]);
  });

  it("falls back to an untied key only for a vendor with no tied key", () => {
    const plan = planReads(vendors, projects, [{ id: "k1", vendor_slug: "vercel", app_project_id: "p1" }], [
      { id: "old-vercel", vendor_slug: "vercel" },
      { id: "old-supabase", vendor_slug: "supabase", settings: { projectRef: "abcdefghijklmnopqrst" } },
    ], readable);
    expect(plan.map((t) => [t.connectionId, t.project?.id ?? null])).toEqual([
      ["k1", "p1"],
      ["old-supabase", null],
    ]);
  });

  it("skips vendors birdsI cannot read, and projects without a key", () => {
    expect(planReads(vendors, projects, [], [{ id: "c", vendor_slug: "clerk" }], readable)).toEqual([]);
  });
});
