import { describe, expect, it } from "vitest";
import { forgeLabel, repoFromUrl, repoLabel, repoSegments } from "./types";

// Same rules as repoFromUrl in core/forges.mjs: a PR URL maps to one repository id per provider.
describe("repoFromUrl", () => {
  const origins = { gitea: "https://git.example", bitbucket: "https://bitbucket.org", bitbucketdc: "https://bb.corp", azure: "https://dev.azure.com", forgejo: "" };
  it("maps each provider's PR URL to its repository id", () => {
    expect(repoFromUrl("https://github.com/acme/shop/pull/7", origins)).toBe("acme/shop");
    expect(repoFromUrl("https://git.example/acme/shop/pulls/7", origins)).toBe("gitea~acme/shop");
    expect(repoFromUrl("https://bitbucket.org/team/app/pull-requests/5", origins)).toBe("bitbucket~team/app");
    expect(repoFromUrl("https://bb.corp/projects/PROJ/repos/app/pull-requests/9", origins)).toBe("bitbucketdc~PROJ/app");
    expect(repoFromUrl("https://dev.azure.com/contoso/Web%20Shop/_git/api/pullrequest/31", origins)).toBe("azure~contoso/Web Shop/api");
  });
  it("refuses unknown hosts and shapes", () => {
    expect(repoFromUrl("https://evil.example/acme/shop/pull/7", origins)).toBe("");
    expect(repoFromUrl("https://bb.corp/users/me/repos/app/pull-requests/9", origins)).toBe("");
    expect(repoFromUrl("https://dev.azure.com/contoso/_apis/git", origins)).toBe("");
    expect(repoFromUrl("not a url", origins)).toBe("");
  });
  it("labels and segment counts", () => {
    expect(repoLabel("azure~contoso/Web Shop/api")).toBe("contoso/Web Shop/api · Azure DevOps");
    expect(forgeLabel("bitbucketdc~PROJ/app")).toBe("Bitbucket Data Center");
    expect(forgeLabel("acme/shop")).toBe("GitHub");
    expect(repoSegments("azure~contoso")).toBe(3);
    expect(repoSegments("bitbucket~team")).toBe(2);
  });
});
