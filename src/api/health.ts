import type { Context } from "hono";

export function healthHandler(c: Context) {
  return c.json({ ok: true, ts: new Date().toISOString() });
}
