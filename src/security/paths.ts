import { resolve, normalize, sep } from "path";

/**
 * Resolves an input path against the workspace root.
 * Normalizes separators and resolves relative segments.
 */
export function resolveWorkspacePath(inputPath: string, workspaceRoot: string): string {
  const normalized = normalize(inputPath);
  // If absolute, use as-is (assertWithinWorkspace will reject if out of root)
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return resolve(normalized);
  }
  return resolve(workspaceRoot, normalized);
}

/**
 * Throws if the resolved path is outside the workspace root.
 * Guards against path traversal attacks.
 */
export function assertWithinWorkspace(
  resolvedPath: string,
  workspaceRoot: string
): void {
  const root = resolve(workspaceRoot);
  const target = resolve(resolvedPath);

  if (!target.startsWith(root + sep) && target !== root) {
    throw new Error(
      `Path "${resolvedPath}" is outside the workspace root. Access denied.`
    );
  }
}
