import type { GoogleClientCredentials } from "./types";

export class InvalidClientSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClientSecretError";
  }
}

/**
 * Parse a client_secret.json buffer into credentials.
 *
 * Accepts only Desktop (installed) credential type. Web credentials require
 * pre-registered redirect URIs and are incompatible with the manual loopback flow.
 * Throws InvalidClientSecretError with a user-friendly message on any problem.
 */
export function parseClientSecret(buf: Buffer): GoogleClientCredentials {
  let json: unknown;
  try {
    json = JSON.parse(buf.toString("utf-8"));
  } catch {
    throw new InvalidClientSecretError("File is not valid JSON.");
  }

  const obj = json as Record<string, unknown>;
  const block = obj.installed as Record<string, unknown> | undefined;

  if (!block) {
    if (obj.web) {
      throw new InvalidClientSecretError(
        "This is a Web application credential. tdmClaw requires a Desktop credential. " +
          'In Google Cloud Console, create a new OAuth Client ID of type "Desktop app" ' +
          "and upload that JSON instead."
      );
    }
    throw new InvalidClientSecretError(
      'Missing "installed" key. This does not look like a Desktop credential file.'
    );
  }

  const clientId = typeof block.client_id === "string" ? block.client_id.trim() : "";
  const clientSecret =
    typeof block.client_secret === "string" ? block.client_secret.trim() : "";

  if (!clientId || !clientSecret) {
    throw new InvalidClientSecretError(
      "Missing client_id or client_secret in the installed credential."
    );
  }

  return {
    clientId,
    clientSecret,
    projectId: typeof block.project_id === "string" ? block.project_id : undefined,
  };
}
