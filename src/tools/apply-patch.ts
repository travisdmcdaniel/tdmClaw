import { readFileSync, writeFileSync } from "fs";
import { assertWithinWorkspace, resolveWorkspacePath } from "../security/paths";
import type { ToolHandler } from "../agent/tool-registry";
import type { ToolContext } from "../agent/tool-registry";

/**
 * Patch format:
 *
 * <<<<<<< path/to/file
 * old content to replace
 * =======
 * new content
 * >>>>>>> path/to/file
 *
 * Multiple hunks in one patch input are supported.
 */

type ApplyPatchArgs = {
  input: string;
};

type PatchHunk = {
  path: string;
  oldContent: string;
  newContent: string;
};

export function createApplyPatchTool(workspaceRoot: string): ToolHandler {
  return {
    definition: {
      name: "apply_patch",
      description:
        "Apply one or more targeted edits to files within the workspace. " +
        "Uses a conflict-marker format: <<<<<<< path, old content, =======, new content, >>>>>>> path.",
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Patch input in the conflict-marker format.",
          },
        },
        required: ["input"],
      },
    },

    async execute(args: unknown, ctx: ToolContext): Promise<unknown> {
      const { input } = args as ApplyPatchArgs;
      const hunks = parsePatch(input);

      if (hunks.length === 0) {
        throw new Error("No valid patch hunks found in input.");
      }

      const results: Array<{ path: string; status: string }> = [];

      for (const hunk of hunks) {
        const resolved = resolveWorkspacePath(hunk.path, workspaceRoot);
        assertWithinWorkspace(resolved, workspaceRoot);

        let fileContent: string;
        try {
          fileContent = readFileSync(resolved, "utf-8");
        } catch {
          results.push({ path: hunk.path, status: "error: file not found" });
          continue;
        }

        if (!fileContent.includes(hunk.oldContent)) {
          results.push({ path: hunk.path, status: "error: old content not found in file" });
          ctx.logger.warn({ path: hunk.path }, "Patch hunk: old content not found");
          continue;
        }

        const updated = fileContent.replace(hunk.oldContent, hunk.newContent);
        writeFileSync(resolved, updated, "utf-8");
        results.push({ path: hunk.path, status: "applied" });
      }

      return { hunksApplied: results.filter((r) => r.status === "applied").length, results };
    },
  };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parsePatch(input: string): PatchHunk[] {
  // Normalize line endings and strip markdown code fences that LLMs may add.
  let normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  normalized = normalized.replace(/^```[^\n]*\n([\s\S]*?)```\s*$/gm, "$1");

  const hunks: PatchHunk[] = [];
  // Matches: <<<<<<< <path>\n<old>=======\n<new>>>>>>>> <path>
  // oldContent and newContent may be empty, so we don't require a \n before
  // the separator/end-marker — we split on the markers directly.
  const HUNK_RE = /^<<<<<<< (.+?)\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> .+?(?:\n|$)/gm;

  let match: RegExpExecArray | null;
  while ((match = HUNK_RE.exec(normalized)) !== null) {
    // Strip trailing newline that the regex captured as part of the block.
    const oldContent = match[2]!.replace(/\n$/, "");
    const newContent = match[3]!.replace(/\n$/, "");
    hunks.push({
      path: match[1]!.trim(),
      oldContent,
      newContent,
    });
  }
  return hunks;
}
