import { describe, expect, it } from "vitest";
import { applyEdits, EditError, toUnifiedDiff } from "./edits";

const files: Record<string, string> = {
  "a.ts": "const a = 1;\nconst b = 2;\nconsole.log(a, b);\n",
  ".gitignore": "node_modules\n",
};
const read = async (path: string) => files[path] ?? null;

describe("applyEdits", () => {
  it("replaces unique text and reports the changed files", async () => {
    const result = await applyEdits([{ op: "replace", path: "a.ts", search: "const b = 2;", replace: "const b = 3;" }], read);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("const b = 3;");
    expect(result[0]!.before).toContain("const b = 2;");
  });

  it("refuses ambiguous and missing search text", async () => {
    await expect(applyEdits([{ op: "replace", path: "a.ts", search: "const", replace: "let" }], read)).rejects.toBeInstanceOf(EditError);
    await expect(applyEdits([{ op: "replace", path: "a.ts", search: "nothing here", replace: "x" }], read)).rejects.toBeInstanceOf(EditError);
  });

  it("tolerates indentation differences line by line", async () => {
    const result = await applyEdits([{ op: "replace", path: "a.ts", search: "  const a = 1;\n  const b = 2;", replace: "const a = 10;\nconst b = 20;" }], read);
    expect(result[0]!.content).toBe("const a = 10;\nconst b = 20;\nconsole.log(a, b);\n");
  });

  it("creates, deletes and blocks paths outside the repository", async () => {
    const result = await applyEdits(
      [
        { op: "create", path: ".env.example", content: "KEY=\n" },
        { op: "delete", path: ".gitignore" },
      ],
      read,
    );
    expect(result.find((f) => f.path === ".env.example")?.content).toBe("KEY=\n");
    expect(result.find((f) => f.path === ".gitignore")?.content).toBeNull();
    await expect(applyEdits([{ op: "create", path: "../evil", content: "" }], read)).rejects.toBeInstanceOf(EditError);
    await expect(applyEdits([{ op: "create", path: "a.ts", content: "" }], read)).rejects.toBeInstanceOf(EditError);
  });
});

describe("toUnifiedDiff", () => {
  it("produces a diff git can read", async () => {
    const result = await applyEdits([{ op: "replace", path: "a.ts", search: "const b = 2;", replace: "const b = 3;" }], read);
    const diff = toUnifiedDiff(result);
    expect(diff).toContain("diff --git a/a.ts b/a.ts");
    expect(diff).toContain("--- a/a.ts");
    expect(diff).toContain("+++ b/a.ts");
    expect(diff).toContain("-const b = 2;");
    expect(diff).toContain("+const b = 3;");
    expect(diff).toMatch(/@@ -1,3 \+1,3 @@/);
  });

  it("marks new and deleted files", async () => {
    const result = await applyEdits([{ op: "create", path: "new.txt", content: "hi\n" }, { op: "delete", path: ".gitignore" }], read);
    const diff = toUnifiedDiff(result);
    expect(diff).toContain("new file mode 100644");
    expect(diff).toContain("deleted file mode 100644");
    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ /dev/null");
  });
});
