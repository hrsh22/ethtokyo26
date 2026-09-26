import { afterEach, expect, it, vi } from "vitest";
import { repositoryName, repositoryReport } from "./repository-research";

afterEach(() => vi.unstubAllGlobals());
it.each(["http://localhost/admin", "https://github.com/a/b/../../secret", "https://evil.test/a/b", "a/..", "a/b?token=x", "https://github.com@evil.test/a/b"])("rejects unsupported source %s", input => {
  expect(() => repositoryName(input)).toThrow();
});
it("normalizes only public GitHub repository identities", () => { expect(repositoryName("https://github.com/ENSdomains/ens-contracts.git")).toBe("ensdomains/ens-contracts"); });
it("delivers sourced evidence, exposes truncated coverage and caches the same snapshot", async () => {
  const source = vi.fn(async (url: string, options: RequestInit) => {
    expect(new URL(url).origin).toBe("https://api.github.com"); expect(options.redirect).toBe("error");
    if (url.endsWith("/readme")) return Response.json({ encoding: "base64", content: Buffer.from("# Project\nSupports TypeScript.\nLicense: MIT\n" + "x".repeat(61_000)).toString("base64"), html_url: "https://github.com/fixture/tool/blob/main/README.md" });
    if (url.includes("/commits?")) return Response.json([{ html_url: "https://github.com/fixture/tool/commit/a" }], { headers: { link: '<https://api.github.com/repos/fixture/tool/commits?page=2>; rel="next"' } });
    if (url.includes("/releases?")) return Response.json([{ tag_name: "v1", published_at: "2026-09-01T00:00:00Z", html_url: "https://github.com/fixture/tool/releases/tag/v1", prerelease: false, draft: false }]);
    return Response.json({ full_name: "fixture/tool", html_url: "https://github.com/fixture/tool", description: "Fixture", archived: false, pushed_at: "2026-09-20T00:00:00Z", default_branch: "main", license: null });
  });
  vi.stubGlobal("fetch", source);
  const report = await repositoryReport(["fixture/tool"], "comparison", ["TypeScript", "webhooks", "ENS"]);
  expect(report.repositories[0]).toMatchObject({ license: "Not reported", maintenance: { truncated: true, commitsObserved: 1 } });
  expect(report.repositories[0]?.capabilityEvidence[0]?.coverage).toContain("60,000");
  expect(report.repositories[0]?.capabilityEvidence[1]?.interpretation).toContain("does not establish lack of support");
  expect(report.repositories[0]?.capabilityEvidence[2]?.excerpts).toEqual([]);
  expect((await repositoryReport(["fixture/tool"], "comparison", ["TypeScript", "webhooks", "ENS"])).collectedAt).toBe(report.collectedAt);
  expect(source).toHaveBeenCalledTimes(4);
});
it("fails before a quote can be offered when GitHub rate limits the source", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 429 })));
  await expect(repositoryReport(["fixture/limited"], "comparison", [])).rejects.toMatchObject({ code: "source_unavailable" });
});
