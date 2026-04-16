const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

/**
 * Truncates a message to fit within Telegram's character limit.
 * Appends a truncation notice if content was cut.
 */
export function truncateForTelegram(text: string): string {
  if (text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) return text;
  const notice = "\n\n[...truncated]";
  return text.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH - notice.length) + notice;
}

/**
 * Formats an error for safe display in Telegram.
 * Never exposes raw stack traces or secrets.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return "An unexpected error occurred.";
}

/**
 * Wraps text in a code block for Telegram HTML parse mode.
 */
export function codeBlock(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// MarkdownV2 reserved characters that must be escaped in plain text:
// _ * [ ] ( ) ~ ` > # + - = | { } . !
const MV2_ESCAPE_RE = /([_*[\]()~`>#+=|{}.!\-\\])/g;

function escapeMV2(text: string): string {
  return text.replace(MV2_ESCAPE_RE, "\\$1");
}

// Inside code spans and code blocks only \ and ` need escaping.
function escapeCodeContent(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

/**
 * Converts a Markdown string to Telegram MarkdownV2 format.
 *
 * Supported constructs:
 *   - Fenced code blocks (``` lang\n ... ```)
 *   - Inline code (`text`)
 *   - Bold (**text** or __text__)
 *   - Italic (*text* or _text_)
 *   - Links [text](url)
 *   - ATX headings (# through ######) → rendered as bold
 *   - Unordered lists (-, *, +) → bullet character •
 *   - Ordered lists (1.) → escaped number + period
 *
 * All other MarkdownV2 reserved characters in plain text are escaped.
 */
export function toMarkdownV2(text: string): string {
  const outputLines: string[] = [];
  const lines = text.split("\n");
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    if (!inCodeBlock) {
      const cbStart = line.match(/^```(.*)$/);
      if (cbStart) {
        inCodeBlock = true;
        codeBlockLang = cbStart[1].trim();
        codeBlockLines = [];
        continue;
      }
      outputLines.push(convertLine(line));
    } else {
      if (line === "```") {
        const code = codeBlockLines.join("\n");
        outputLines.push(
          "```" + codeBlockLang + "\n" + escapeCodeContent(code) + "\n```"
        );
        inCodeBlock = false;
        codeBlockLang = "";
        codeBlockLines = [];
      } else {
        codeBlockLines.push(line);
      }
    }
  }

  // Flush unclosed code block as a code block anyway.
  if (inCodeBlock && codeBlockLines.length > 0) {
    const code = codeBlockLines.join("\n");
    outputLines.push(
      "```" + codeBlockLang + "\n" + escapeCodeContent(code) + "\n```"
    );
  }

  return outputLines.join("\n");
}

function convertLine(line: string): string {
  // ATX heading: # text
  const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
  if (headingMatch) {
    return "*" + convertInline(headingMatch[1]) + "*";
  }
  // Unordered list: - item, * item, + item
  const listMatch = line.match(/^(\s*)[*\-+]\s+(.+)$/);
  if (listMatch) {
    return listMatch[1] + "• " + convertInline(listMatch[2]);
  }
  // Ordered list: 1. item
  const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
  if (orderedMatch) {
    return (
      orderedMatch[1] +
      escapeMV2(orderedMatch[2]) +
      "\\. " +
      convertInline(orderedMatch[3])
    );
  }
  return convertInline(line);
}

function convertInline(text: string): string {
  const parts: string[] = [];
  // Process inline tokens: code first, then bold (** before *), then italic, then links.
  const inlineRe =
    /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = inlineRe.exec(text)) !== null) {
    parts.push(escapeMV2(text.slice(lastIdx, m.index)));

    if (m[1] !== undefined) {
      // `inline code`
      parts.push("`" + escapeCodeContent(m[1]) + "`");
    } else if (m[2] !== undefined) {
      // **bold**
      parts.push("*" + escapeMV2(m[2]) + "*");
    } else if (m[3] !== undefined) {
      // __bold__
      parts.push("*" + escapeMV2(m[3]) + "*");
    } else if (m[4] !== undefined) {
      // *italic*
      parts.push("_" + escapeMV2(m[4]) + "_");
    } else if (m[5] !== undefined) {
      // _italic_
      parts.push("_" + escapeMV2(m[5]) + "_");
    } else if (m[6] !== undefined && m[7] !== undefined) {
      // [link text](url)
      parts.push("[" + escapeMV2(m[6]) + "](" + m[7].replace(/\)/g, "\\)") + ")");
    }

    lastIdx = m.index + m[0].length;
  }

  parts.push(escapeMV2(text.slice(lastIdx)));
  return parts.join("");
}
