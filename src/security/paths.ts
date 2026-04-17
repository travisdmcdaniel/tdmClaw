import { resolve, normalize, sep } from "path";

/**
 * Resolves an input path against the workspace root.
 * Accepts both relative paths and absolute paths already within the workspace.
 * Strips leading separators from relative paths so the model can use "/" to
 * mean "workspace root" without escaping to the real filesystem root.
 */
export function resolveWorkspacePath(inputPath: string, workspaceRoot: string): string {
  const normalized = normalize(inputPath);
  const root = resolve(workspaceRoot);

  // If the path is already absolute and inside the workspace, use it as-is.
  if (normalized.startsWith(root + sep) || normalized === root) {
    return normalized;
  }

  // Otherwise treat as relative — strip any leading separator.
  const relative = normalized.replace(/^[/\\]+/, "");
  return resolve(root, relative);
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
