import { describe, expect, it } from "vitest";
import { permissions } from "./catalog";
import { isPathTraversal, redactSecrets, shouldRequireApproval } from "./security";

describe("security helpers", () => {
  it("blocks traversal style paths", () => {
    expect(isPathTraversal("../secrets.txt")).toBe(true);
    expect(isPathTraversal("workspace/docs/readme.md")).toBe(false);
  });

  it("requires approval for shell permissions", () => {
    expect(shouldRequireApproval([permissions["shell.exec"]])).toBe(true);
    expect(shouldRequireApproval([permissions["fs.read"]])).toBe(false);
  });

  it("redacts common secret patterns", () => {
    expect(redactSecrets("api_key=123456 token=abcdef sk-1234567890")).toContain("...redacted");
  });
});
