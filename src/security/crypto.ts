import { randomBytes, createHash } from "crypto";

/**
 * Generates a cryptographically random hex string of the given byte length.
 */
export function generateSecret(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

/**
 * Creates a SHA-256 hash of a string, returned as hex.
 * Useful for non-sensitive fingerprinting (not for passwords).
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
