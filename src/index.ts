#!/usr/bin/env node
import { bootstrap } from "./app/bootstrap";

bootstrap().catch((err: unknown) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
