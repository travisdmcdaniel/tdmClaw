import { readFileSync } from "fs";
import { assertWithinWorkspace, resolveWorkspacePath } from "../security/paths";
import { truncateOutput } from "./common";
import type { ToolHandler } from "../agent/tool-registry";

const DEFAULT_MAX_LINES = 200;
const MAX_CHARS = 16_000;

type ReadFileArgs = {
  path: string;
  startLine?: number;
  maxLines?: number;
};

export function createReadFileTool(workspaceRoot: string): ToolHandler {
  return {
    definition: {
      name: "read_file",
      description:
        "Read the contents of a file within the workspace. " +
        `Returns up to ${DEFAULT_MAX_LINES} lines by default.`,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to the workspace root.",
          },
          startLine: {
            type: "number",
            description: "1-indexed line number to start reading from.",
          },
          maxLines: {
            type: "number",
            description: `Maximum number of lines to return. Default ${DEFAULT_MAX_LINES}.`,
          },
        },
        required: ["path"],
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { path, startLine = 1, maxLines = DEFAULT_MAX_LINES } = args as ReadFileArgs;
      const resolved = resolveWorkspacePath(path, workspaceRoot);
      assertWithinWorkspace(resolved, workspaceRoot);

      let content: string;
      try {
        content = readFileSync(resolved, "utf-8");
      } catch (err) {
        throw new Error(
          `Cannot read file "${path}": ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const lines = content.split("\n");
      const total = lines.length;
      const start = Math.max(0, startLine - 1);
      const slice = lines.slice(start, start + maxLines).join("\n");
      const truncated = truncateOutput(slice, MAX_CHARS);

      return {
        path,
        totalLines: total,
        startLine: start + 1,
        returnedLines: Math.min(maxLines, total - start),
        content: truncated,
      };
    },
  };
}
