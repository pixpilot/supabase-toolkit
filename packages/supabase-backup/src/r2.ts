import type { R2Config } from './config.js';

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BackupError } from './errors.js';

export interface ObjectStore {
  get: (key: string) => Promise<Uint8Array>;
  has: (key: string) => Promise<boolean>;
  list: (prefix: string) => Promise<string[]>;
  putImmutable: (key: string, body: Uint8Array) => Promise<void>;
}

/** Formats safe S3 error metadata for actionable R2 CLI diagnostics. */
export function r2ErrorDetails(error: unknown): string {
  const r2Error = error as {
    $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
    Code?: unknown;
    name?: unknown;
  };
  let code: string | undefined;
  if (typeof r2Error.Code === 'string') code = r2Error.Code;
  else if (typeof r2Error.name === 'string') code = r2Error.name;
  const status = r2Error.$metadata?.httpStatusCode;
  const requestId = r2Error.$metadata?.requestId;
  const values = [
    code && `r2Code=${code}`,
    typeof status === 'number' && `httpStatus=${status}`,
    typeof requestId === 'string' && `requestId=${requestId}`,
  ].filter(Boolean);
  return values.length ? ` [${values.join(', ')}]` : '';
}

/** R2 object store using S3-compatible, path-style requests. */
export class R2Store implements ObjectStore {
  private readonly client: S3Client;
  public constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: 'auto',
    });
  }

  public async has(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return true;
    } catch (error: unknown) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return false;
      throw new BackupError(`R2 object lookup failed${r2ErrorDetails(error)}.`);
    }
  }

  public async putImmutable(key: string, body: Uint8Array): Promise<void> {
    if (await this.has(key))
      throw new BackupError(`Refusing to overwrite existing R2 object '${key}'.`);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          IfNoneMatch: '*',
        }),
      );
    } catch {
      throw new BackupError(`R2 upload failed for '${key}'.`);
    }
  }

  public async get(key: string): Promise<Uint8Array> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return await output.Body!.transformToByteArray();
    } catch {
      throw new BackupError(`R2 download failed for '${key}'.`);
    }
  }

  public async list(prefix: string): Promise<string[]> {
    try {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.config.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        keys.push(
          ...(page.Contents || []).flatMap((entry) => (entry.Key ? [entry.Key] : [])),
        );
        token = page.NextContinuationToken;
      } while (token);
      return keys;
    } catch {
      throw new BackupError('R2 object listing failed.');
    }
  }
}
