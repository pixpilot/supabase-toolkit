import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRestoreProgress,
  logRestoreProgress,
} from '../src/restore/restore-progress.js';
import { systemRunner } from '../src/utils/process.js';

afterEach(() => vi.restoreAllMocks());

describe('restore progress output', () => {
  it('forwards complete progress lines live, including split chunks, without printing other SQL output', () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const progress = createRestoreProgress([
      { message: 'Restoring Auth data...', file: 'auth.sql' },
    ]);
    progress.onStdout('private SQL output\n[restore] Restor');
    expect(output).not.toHaveBeenCalled();
    progress.onStdout('ing Auth data...\r');
    expect(output).not.toHaveBeenCalled();
    progress.onStdout('\n[restore] unknown message\n');
    expect(output).toHaveBeenCalledExactlyOnceWith('[restore] Restoring Auth data...\n');
  });

  it('redacts database credentials from phase messages', () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logRestoreProgress('Connecting to postgresql://user:secret@host/database...');
    expect(output).toHaveBeenCalledExactlyOnceWith(
      '[restore] Connecting to [redacted database URL]\n',
    );
  });

  it('delivers subprocess progress even when the subprocess later fails', async () => {
    const chunks: string[] = [];
    await expect(
      systemRunner.run(
        process.execPath,
        [
          '-e',
          "process.stdout.write('restore phase started\\n', () => { process.exitCode = 3; });",
        ],
        { onStdout: (chunk) => chunks.push(chunk) },
      ),
    ).rejects.toThrow('exited with code 3');
    expect(chunks.join('')).toBe('restore phase started\n');
  });
});
