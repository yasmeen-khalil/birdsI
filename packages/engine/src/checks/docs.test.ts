import { describe, expect, it } from "vitest";
import { githubRepoOf, hostOf, isOfficialHit } from "./docs";

describe("official documentation sources", () => {
  it("reads hosts from registry urls, including git shapes", () => {
    expect(hostOf("https://www.nextjs.org/docs")).toBe("nextjs.org");
    expect(hostOf("git+https://github.com/vercel/next.js.git")).toBe("github.com");
    expect(hostOf("git://github.com/x/y.git")).toBe("github.com");
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });

  it("finds the GitHub repository behind a package", () => {
    expect(githubRepoOf("git+https://github.com/vercel/next.js.git")).toBe("vercel/next.js");
    expect(githubRepoOf("https://github.com/Clerk/javascript/issues")).toBe("clerk/javascript");
    expect(githubRepoOf("https://gitlab.com/a/b")).toBeNull();
  });

  it("counts only the package's own pages and GitHub advisories", () => {
    const sources = { domains: ["nextjs.org", "github.com"], githubRepo: "vercel/next.js" };
    expect(isOfficialHit("https://nextjs.org/docs/upgrading", sources)).toBe(true);
    expect(isOfficialHit("https://github.com/vercel/next.js/releases/tag/v16.3.8", sources)).toBe(true);
    expect(isOfficialHit("https://github.com/advisories/GHSA-0000-0000-0000", sources)).toBe(true);
    expect(isOfficialHit("https://github.com/vercel/next.jsx-fork/releases", sources)).toBe(false);
    expect(isOfficialHit("https://github.com/someone/next-blog-post", sources)).toBe(false);
    expect(isOfficialHit("https://medium.com/next-js-16-breaking-changes", sources)).toBe(false);
    expect(isOfficialHit("https://dev.to/nextjs", sources)).toBe(false);
  });
});
