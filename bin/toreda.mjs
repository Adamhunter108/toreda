#!/usr/bin/env node
// The `toreda` command. Registers tsx's ESM loader so the TypeScript under
// src/ runs directly — no build step, which keeps the repo hackable: a user (or
// Claude) can edit a scanner threshold and see it on the very next run.
import { register } from "tsx/esm/api";

register();
await import(new URL("../src/cli/index.ts", import.meta.url).href);
