import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { assertWithinWorkspace, resolveWorkspacePath } from "../security/paths";
import type { ToolHandler } from "../agent/tool-registry";

type WriteFileArgs = {
  path: string;
  content: string;
};

export function createWriteFileTool(workspaceRoot: string): ToolHandler {
  return {
    definition: {
      name: "write_file",
      description: "Write content to a file within the workspace. Creates parent directories as needed. Overwrites existing files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to the workspace root, or an absolute path within it.",
          },
          content: {
            type: "string",
            description: "Full file content to write.",
          },
        },
        required: ["path", "content"],
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { path, content } = args as WriteFileArgs;
      const resolved = resolveWorkspacePath(path, workspaceRoot);
      assertWithinWorkspace(resolved, workspaceRoot);

      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, content, "utf-8");

      return { path, bytesWritten: Buffer.byteLength(content, "utf-8") };
    },
  };
}
