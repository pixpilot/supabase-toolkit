import type { InputField } from '../../core/input.js';
import type { ObjectStore, StorageAdapter, StorageSettings } from '../object-store.js';

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { required } from '../../core/env.js';
import { BackupError } from '../../core/errors.js';
import {
  ensureOpaqueSecret,
  ensureValidR2Bucket,
  ensureValidR2Endpoint,
} from '../../core/validation.js';

export interface R2Config extends StorageSettings {
  accessKeyId: string;
  bucket: string;
  driver?: 'r2';
  endpoint: string;
  secretAccessKey: string;
}

/** R2 credentials and location, asked for only when this backend is selected. */
export const r2Fields: readonly InputField[] = [
  {
    flag: '--r2-endpoint',
    name: 'R2_ENDPOINT',
    question: 'R2 S3 endpoint (https://<account-id>.r2.cloudflarestorage.com)',
    validate: ensureValidR2Endpoint,
  },
  {
    flag: '--r2-bucket',
    name: 'R2_BUCKET',
    question: 'R2 bucket name',
    validate: ensureValidR2Bucket,
  },
  {
    flag: '--r2-access-key-id',
    name: 'R2_ACCESS_KEY_ID',
    question: 'R2 access key ID',
    secret: true,
    validate: (value: string): void => ensureOpaqueSecret('--r2-access-key-id', value),
  },
  {
    flag: '--r2-secret-access-key',
    name: 'R2_SECRET_ACCESS_KEY',
    question: 'R2 secret access key',
    secret: true,
    validate: (value: string): void =>
      ensureOpaqueSecret('--r2-secret-access-key', value),
  },
];

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

/** Reads and checks the R2 credentials and location. */
export function loadR2Config(env: NodeJS.ProcessEnv): R2Config {
  const config = {
    accessKeyId: required(env, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY'),
    endpoint: required(env, 'R2_ENDPOINT'),
    bucket: required(env, 'R2_BUCKET'),
  };
  ensureOpaqueSecret('R2_ACCESS_KEY_ID', config.accessKeyId);
  ensureOpaqueSecret('R2_SECRET_ACCESS_KEY', config.secretAccessKey);
  ensureValidR2Endpoint(config.endpoint);
  ensureValidR2Bucket(config.bucket);
  return { ...config, driver: 'r2' };
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

/** Cloudflare R2, the default backend. */
export const r2Adapter: StorageAdapter<R2Config> = {
  driver: 'r2',
  summary: 'Cloudflare R2 bucket over the S3 API.',
  fields: r2Fields,
  loadConfig: loadR2Config,
  createStore: (config: R2Config): ObjectStore => new R2Store(config),
};
