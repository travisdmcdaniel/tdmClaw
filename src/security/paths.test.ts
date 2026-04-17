import { describe, expect, it } from "vitest";
import { resolveWorkspacePath, assertWithinWorkspace } from "./paths";

describe("resolveWorkspacePath", () => {
  const root = "/workspace";

  it("resolves a relative path against the workspace root", () => {
    expect(resolveWorkspacePath("notes.txt", root)).toBe("/workspace/notes.txt");
  });

  it("resolves a nested relative path", () => {
    expect(resolveWorkspacePath("jobs/jobs.json", root)).toBe(
      "/workspace/jobs/jobs.json"
    );
  });

  it("strips a leading slash from relative-style paths", () => {
    // Model may use "/" to mean "workspace root"
    expect(resolveWorkspacePath("/notes.txt", root)).toBe("/workspace/notes.txt");
  });

  it("returns an absolute path that is already inside the workspace unchanged", () => {
    expect(resolveWorkspacePath("/workspace/subdir/file.ts", root)).toBe(
      "/workspace/subdir/file.ts"
    );
  });
});

describe("assertWithinWorkspace", () => {
  const root = "/workspace";

  it("does not throw for a path inside the workspace", () => {
    expect(() =>
      assertWithinWorkspace("/workspace/notes.txt", root)
    ).not.toThrow();
  });

  it("does not throw for a deeply nested path", () => {
    expect(() =>
      assertWithinWorkspace("/workspace/a/b/c/d.txt", root)
    ).not.toThrow();
  });

  it("does not throw for the workspace root itself", () => {
    expect(() => assertWithinWorkspace("/workspace", root)).not.toThrow();
  });

  it("throws for a path outside the workspace", () => {
    expect(() =>
      assertWithinWorkspace("/etc/passwd", root)
    ).toThrow("outside the workspace root");
  });

  it("throws for a path traversal attempt", () => {
    expect(() =>
      assertWithinWorkspace("/workspace/../etc/passwd", root)
    ).toThrow("outside the workspace root");
  });

  it("throws for a sibling directory that starts with the workspace name", () => {
    // /workspace-other must not be treated as inside /workspace
    expect(() =>
      assertWithinWorkspace("/workspace-other/file.txt", root)
    ).toThrow("outside the workspace root");
  });
});
