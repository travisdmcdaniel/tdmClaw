import { spawn } from "child_process";
import { resolve } from "path";
import { checkExecPolicy } from "../security/exec-policy";
import { truncateOutput } from "./common";
import type { ToolHandler, ToolContext } from "../agent/tool-registry";
import type { AppConfig } from "../app/config";

export type ExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
};

type ExecArgs = {
  command: string;
  workdir?: string;
  timeoutSeconds?: number;
};

export function createExecTool(execConfig: AppConfig["tools"]["exec"]): ToolHandler {
  return {
    definition: {
      name: "exec",
      description:
        "Execute a shell command on the host. Output is captured and truncated. " +
        "Dangerous commands require appropriate permissions.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute.",
          },
          workdir: {
            type: "string",
            description: "Working directory for the command (must be an absolute path).",
          },
          timeoutSeconds: {
            type: "number",
            description: `Maximum execution time in seconds. Default ${execConfig.timeoutSeconds}.`,
          },
        },
        required: ["command"],
      },
    },

    async execute(args: unknown, ctx: ToolContext): Promise<unknown> {
      const {
        command,
        workdir,
        timeoutSeconds = execConfig.timeoutSeconds,
      } = args as ExecArgs;

      // Policy check
      checkExecPolicy(execConfig, command, ctx.senderTelegramUserId);

      // Resolve working directory
      const cwd = workdir ? resolve(workdir) : process.cwd();

      ctx.logger.info({ command, cwd }, "Executing command");

      const result = await spawnCommand(command, cwd, timeoutSeconds * 1000, execConfig.maxOutputChars);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function spawnCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  maxOutputChars: number
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn("sh", ["-c", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      const truncatedStdout = truncateOutput(stdout, maxOutputChars);
      const truncatedStderr = truncateOutput(stderr, Math.floor(maxOutputChars / 4));
      resolve({
        exitCode,
        stdout: truncatedStdout,
        stderr: truncatedStderr,
        truncated: stdout.length > maxOutputChars || stderr.length > Math.floor(maxOutputChars / 4),
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout: "",
        stderr: err.message,
        truncated: false,
        timedOut: false,
      });
    });
  });
}
