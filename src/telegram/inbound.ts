import type { Context } from "grammy";
import { mkdir, readdir, rm, stat, writeFile } from "fs/promises";
import { extname, posix } from "path";

const SUPPORTED_TEXT_DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".json"]);
const TELEGRAM_UPLOAD_DIR = "telegram_uploads";
const RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_MAX_FILES = 100;

export type TelegramUploadConfig = {
  retention: {
    enabled: boolean;
  };
};

export type PreparedInboundMessage =
  | { kind: "command"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "unsupported-document"; filename?: string }
  | { kind: "empty" };

/**
 * Normalizes a Telegram message into either a command string or a plain user
 * message for the agent. Supported text documents are downloaded into the
 * workspace and referenced in the user prompt.
 */
export async function prepareInboundMessage(
  ctx: Context,
  botToken: string,
  workspaceRoot: string,
  uploadConfig: TelegramUploadConfig
): Promise<PreparedInboundMessage> {
  const text = getMessageText(ctx);
  if (text.trim().startsWith("/")) {
    return { kind: "command", text: text.trim() };
  }

  const doc = ctx.message?.document;
  if (doc && isSupportedTextDocument(doc.file_name)) {
    const savedPath = await saveDocumentToWorkspace(
      ctx,
      botToken,
      workspaceRoot,
      uploadConfig,
      doc.file_id,
      doc.file_name
    );
    const parts = [];
    if (text.trim()) {
      parts.push(text.trim());
    }
    parts.push(
      `An attachment was saved to workspace path "/${savedPath}". ` +
        "Use read_file to inspect the contents."
    );
    if (doc.file_name) {
      parts.push(`Original filename: ${doc.file_name}`);
    }
    return { kind: "agent", text: parts.join("\n\n") };
  }

  if (text.trim()) {
    return { kind: "agent", text: text.trim() };
  }

  if (doc) {
    return { kind: "unsupported-document", filename: doc.file_name };
  }

  return { kind: "empty" };
}

export function isSupportedTextDocument(filename?: string): boolean {
  if (!filename) return false;
  return SUPPORTED_TEXT_DOCUMENT_EXTENSIONS.has(extname(filename).toLowerCase());
}

function getMessageText(ctx: Context): string {
  return ctx.message?.text ?? ctx.message?.caption ?? "";
}

async function downloadDocumentText(
  ctx: Context,
  botToken: string,
  fileId: string
): Promise<string> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not provide a downloadable file path.");
  }

  const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Telegram file download failed with status ${res.status}.`);
  }

  return res.text();
}

async function saveDocumentToWorkspace(
  ctx: Context,
  botToken: string,
  workspaceRoot: string,
  uploadConfig: TelegramUploadConfig,
  fileId: string,
  filename?: string
): Promise<string> {
  const safeName = sanitizeFilename(filename);
  const relativePath = posix.join(TELEGRAM_UPLOAD_DIR, safeName);
  const absolutePath = posix.join(workspaceRoot, relativePath);
  const content = await downloadDocumentText(ctx, botToken, fileId);

  await mkdir(posix.dirname(absolutePath), { recursive: true });
  if (uploadConfig.retention.enabled) {
    await pruneTelegramUploads(workspaceRoot);
  }
  await writeFile(absolutePath, content, "utf-8");

  return relativePath;
}

function sanitizeFilename(filename?: string): string {
  const original = (filename && posix.basename(filename).trim()) || "upload.txt";
  const cleaned = original.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${Date.now()}-${cleaned}`;
}

async function pruneTelegramUploads(workspaceRoot: string): Promise<void> {
  const uploadDir = posix.join(workspaceRoot, TELEGRAM_UPLOAD_DIR);

  let names: string[];
  try {
    names = await readdir(uploadDir);
  } catch {
    return;
  }

  const now = Date.now();
  const files: Array<{ absolutePath: string; mtimeMs: number }> = [];

  for (const name of names) {
    const absolutePath = posix.join(uploadDir, name);
    let info;
    try {
      info = await stat(absolutePath);
    } catch {
      continue;
    }

    if (!info.isFile()) {
      continue;
    }

    if (now - info.mtimeMs > RETENTION_MAX_AGE_MS) {
      await rm(absolutePath, { force: true });
      continue;
    }

    files.push({ absolutePath, mtimeMs: info.mtimeMs });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const stale of files.slice(RETENTION_MAX_FILES)) {
    await rm(stale.absolutePath, { force: true });
  }
}
