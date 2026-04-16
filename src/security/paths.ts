import { resolve, normalize, sep } from "path";

/**
 * Resolves an input path against the workspace root.
 * Normalizes separators and resolves relative segments.
 */
export function resolveWorkspacePath(inputPath: string, workspaceRoot: string): string {
  const normalized = normalize(inputPath);
  // Strip any leading separator so the model can use "/" to mean "workspace root"
  // without escaping to the real filesystem root.
  const relative = normalized.replace(/^[/\\]+/, "");
  return resolve(workspaceRoot, relative);
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
