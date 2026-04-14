import { readdirSync, statSync } from "fs";
import { join } from "path";
import { assertWithinWorkspace, resolveWorkspacePath } from "../security/paths";
import type { ToolHandler } from "../agent/tool-registry";

const MAX_ENTRIES = 200;
const DEFAULT_DEPTH = 2;

type ListFilesArgs = {
  path: string;
  depth?: number;
};

export function createListFilesTool(workspaceRoot: string): ToolHandler {
  return {
    definition: {
      name: "list_files",
      description: "List files and directories within the workspace. Returns a compact path listing.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to the workspace root to list.",
          },
          depth: {
            type: "number",
            description: `Maximum recursion depth. Default ${DEFAULT_DEPTH}.`,
          },
        },
        required: ["path"],
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { path, depth = DEFAULT_DEPTH } = args as ListFilesArgs;
      const resolved = resolveWorkspacePath(path, workspaceRoot);
      assertWithinWorkspace(resolved, workspaceRoot);

      const entries: string[] = [];
      collectEntries(resolved, workspaceRoot, depth, 0, entries);

      return {
        path,
        entries: entries.slice(0, MAX_ENTRIES),
        truncated: entries.length > MAX_ENTRIES,
      };
    },
  };
}

function collectEntries(
  dirPath: string,
  root: string,
  maxDepth: number,
  currentDepth: number,
  out: string[]
): void {
  if (out.length >= MAX_ENTRIES) return;

  let children: string[];
  try {
    children = readdirSync(dirPath);
  } catch {
    return;
  }

  for (const name of children) {
    if (out.length >= MAX_ENTRIES) break;
    const full = join(dirPath, name);
    const rel = full.slice(root.length).replace(/\\/g, "/");

    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }

    out.push(isDir ? `${rel}/` : rel);

    if (isDir && currentDepth < maxDepth - 1) {
      collectEntries(full, root, maxDepth, currentDepth + 1, out);
    }
  }
}
