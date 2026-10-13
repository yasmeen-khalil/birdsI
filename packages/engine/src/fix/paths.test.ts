import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveInsideRoot } from "./paths";
import { filterModelFindings, type ModelFinding } from "../checks/model-findings";

let outer: string;
let root: string;

beforeAll(async () => {
  outer = await mkdtemp(join(tmpdir(), "birdsi-paths-"));
  root = join(outer, "repo");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(outer, "secret.txt"), "TOKEN=1\n");
  await symlink(join(outer, "secret.txt"), join(root, "link.txt"));
});

afterAll(async () => {
  await rm(outer, { recursive: true, force: true });
});

describe("resolveInsideRoot", () => {
  it("allows files inside the snapshot, existing or not", async () => {
    expect(await resolveInsideRoot(root, "src/a.ts")).toMatch(/src[\\/]a\.ts$/);
    expect(await resolveInsideRoot(root, "src/new.ts")).toMatch(/src[\\/]new\.ts$/);
  });

  it("refuses paths that leave the snapshot", async () => {
    expect(await resolveInsideRoot(root, "../secret.txt")).toBeNull();
    expect(await resolveInsideRoot(root, "src/../../secret.txt")).toBeNull();
    expect(await resolveInsideRoot(root, "../../../../../proc/self/environ")).toBeNull();
    expect(await resolveInsideRoot(root, "/etc/passwd")).toBeNull();
    expect(await resolveInsideRoot(root, "")).toBeNull();
    expect(await resolveInsideRoot(root, ".")).toBeNull();
  });

  it("refuses a symlink that points outside the snapshot", async () => {
    expect(await resolveInsideRoot(root, "link.txt")).toBeNull();
  });
});

describe("filterModelFindings", () => {
  it("drops fix paths that are not files in the snapshot", () => {
    const finding = {
      title: "A problem",
      certainty: 0.9,
      path: "src/a.ts",
      lineStart: 1,
      lineEnd: 1,
      fixPaths: ["src/a.ts", "../../../../../proc/self/environ", "/etc/passwd"],
    } as unknown as ModelFinding;
    const [kept] = filterModelFindings([finding], 0.5, new Set(["src/a.ts"]));
    expect(kept!.fixPaths).toEqual(["src/a.ts"]);
  });
});
