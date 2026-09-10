/** Error whose message is safe to display from the CLI. */
export class BackupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}
