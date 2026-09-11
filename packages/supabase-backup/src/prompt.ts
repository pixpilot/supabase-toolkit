import type { Interface as PromiseInterface } from 'node:readline/promises';
import { createInterface } from 'node:readline/promises';
import { BackupError } from './errors.js';
import { redact } from './redact.js';

/**
 * Interactive input built on node:readline/promises.
 *
 * Prompts are written to the error stream so command output stays machine
 * readable, secrets are never echoed, and a non-TTY session never prompts at
 * all: unattended runs must fail with a missing-value error instead of blocking
 * on a pipe that will never answer.
 */

/** Streams a prompt reads from and writes to. */
export interface PromptStreams {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

export interface TextPromptOptions {
  defaultValue?: string;
  secret?: boolean;
  validate?: (value: string) => void;
}

/** Asks for values that were not supplied by a flag or the environment. */
export interface Prompter {
  close: () => void;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
  note: (text: string) => void;
  select: (question: string, choices: readonly string[]) => Promise<number>;
  text: (question: string, options?: TextPromptOptions) => Promise<string>;
}

/** Bounds a single answer so a pasted file cannot be read as one value. */
const maximumAnswerLength = 4096;

/** Attempts allowed before an unusable answer ends the command. */
const maximumAttempts = 3;

/** Signature of the stream write swapped out while a secret is being typed. */
type StreamWrite = NodeJS.WriteStream['write'];

class ReadlinePrompter implements Prompter {
  private readonly readline: PromiseInterface;
  private pending: AbortController | undefined;
  private closed = false;

  public constructor(private readonly streams: PromptStreams) {
    this.readline = createInterface({
      input: streams.input,
      output: streams.output,
      terminal: true,
      historySize: 0,
    });
    this.readline.on('SIGINT', () => this.cancel());
    this.readline.on('close', () => this.pending?.abort());
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readline.close();
  }

  public async text(question: string, options: TextPromptOptions = {}): Promise<string> {
    const secret = options.secret === true;
    /* A default is only ever shown for a value that is safe to display. */
    const suffix =
      options.defaultValue === undefined || secret ? '' : ` [${options.defaultValue}]`;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const answer =
        (await this.ask(`${question}${suffix}: `, secret)) || options.defaultValue || '';
      if (!answer) {
        this.note('A value is required.');
        continue;
      }
      try {
        options.validate?.(answer);
        return answer;
      } catch (error: unknown) {
        this.note(redact(error instanceof Error ? error.message : 'Invalid value.'));
      }
    }
    throw new BackupError('Too many invalid answers.');
  }

  public async confirm(question: string, defaultValue = false): Promise<boolean> {
    const hint = defaultValue ? '[Y/n]' : '[y/N]';
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const answer = (await this.ask(`${question} ${hint}: `, false)).toLowerCase();
      if (!answer) return defaultValue;
      if (answer === 'y' || answer === 'yes') return true;
      if (answer === 'n' || answer === 'no') return false;
      this.note('Answer y or n.');
    }
    throw new BackupError('Too many invalid answers.');
  }

  public async select(question: string, choices: readonly string[]): Promise<number> {
    if (!choices.length) throw new BackupError('Nothing to select.');
    this.note(question);
    for (const [index, choice] of choices.entries())
      this.note(`  ${index + 1}) ${choice}`);
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const answer = await this.ask(`Select 1-${choices.length}: `, false);
      const selected = Number(answer);
      if (Number.isInteger(selected) && selected >= 1 && selected <= choices.length)
        return selected - 1;
      this.note(`Enter a number between 1 and ${choices.length}.`);
    }
    throw new BackupError('Too many invalid answers.');
  }

  /** Reads one line, suppressing the echo of secret answers. */
  private async ask(query: string, secret: boolean): Promise<string> {
    if (this.closed) throw new BackupError('Input stream closed before answering.');
    const controller = new AbortController();
    this.pending = controller;
    const restoreEcho = secret ? this.mute(query) : undefined;
    try {
      const answer = await this.readline.question(secret ? '' : query, {
        signal: controller.signal,
      });
      if (answer.length > maximumAnswerLength)
        throw new BackupError(
          `Answer exceeds ${maximumAnswerLength} characters. Supply the value through the environment instead.`,
        );
      /* A secret is returned exactly as entered; only visible text is trimmed. */
      return secret ? answer : answer.trim();
    } catch (error: unknown) {
      if (error instanceof BackupError) throw error;
      if (controller.signal.aborted) throw new BackupError('Prompt cancelled.');
      throw new BackupError(
        `Reading the answer failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.pending = undefined;
      restoreEcho?.();
    }
  }

  /**
   * Silences the output stream for the duration of one answer.
   *
   * readline draws every keystroke through `output.write`, so replacing that one
   * function keeps a typed secret off the screen without touching readline's
   * private `_writeToOutput` hook. Nothing else writes to the stream while an
   * answer is pending, and this method is the only place that swaps the write,
   * so echo suppression stays isolated here.
   */
  private mute(query: string): () => void {
    const { output } = this.streams;
    const original = output.write.bind(output);
    original(query);
    output.write = ((): boolean => true) as StreamWrite;
    return () => {
      output.write = original;
      original('\n');
    };
  }

  /** Ends a pending answer, or the process when nothing is being asked. */
  private cancel(): void {
    if (this.pending) {
      this.pending.abort();
      return;
    }
    this.close();
    this.streams.output.write('\n');
    process.kill(process.pid, 'SIGINT');
  }

  /** Writes a line that is context for the next question, not a question. */
  public note(text: string): void {
    this.streams.output.write(`${text}\n`);
  }
}

/** Reports whether both streams are a terminal a person can answer from. */
export function isInteractive(streams: PromptStreams): boolean {
  return Boolean(streams.input.isTTY) && Boolean(streams.output.isTTY);
}

/**
 * Picks the streams a prompt can use, or nothing when this session cannot ask.
 *
 * Answers can only come from a terminal on stdin. Questions go to stderr so
 * command output stays machine readable, but a redirected stderr would hide
 * them, so stdout is used instead when only it is a terminal.
 */
export function interactiveStreams(
  input: NodeJS.ReadStream = process.stdin,
  outputs: readonly NodeJS.WriteStream[] = [process.stderr, process.stdout],
): PromptStreams | undefined {
  if (!input.isTTY) return undefined;
  const output = outputs.find((stream) => stream.isTTY);
  return output ? { input, output } : undefined;
}

/** Creates a prompter; callers must close it before starting long work. */
export function createPrompter(streams: PromptStreams): Prompter {
  if (!isInteractive(streams))
    throw new BackupError('Interactive input is unavailable outside a terminal.');
  return new ReadlinePrompter(streams);
}
