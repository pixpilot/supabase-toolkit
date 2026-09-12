#!/usr/bin/env node
import { runCli } from './cli/command-line.js';
import { redact } from './utils/redact.js';

runCli().catch((error: unknown) => {
  process.stderr.write(
    `${redact(error instanceof Error ? error.message : 'Unexpected backup failure.')}\n`,
  );
  process.exitCode = 1;
});
