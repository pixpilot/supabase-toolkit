#!/usr/bin/env node
import { runCli } from './command-line.js';
import { redact } from './redact.js';

runCli().catch((error: unknown) => {
  process.stderr.write(
    `${redact(error instanceof Error ? error.message : 'Unexpected backup failure.')}\n`,
  );
  process.exitCode = 1;
});
