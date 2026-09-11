import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const NOT_FOUND_STATUS = 404;
const JSON_INDENTATION = 2;

/**
 * @param {string} name
 * @returns {string} The required environment variable.
 */
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/**
 * @param {unknown} error
 * @returns {{ name: string; message: string; httpStatus: number | undefined; r2Code: string | undefined; requestId: string | undefined }} Safe error metadata.
 */
function errorDetails(error) {
  /** @type {{ $metadata?: { httpStatusCode?: number; requestId?: string }; Code?: string; code?: string }} */
  const details = error && typeof error === 'object' ? error : {};
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
    httpStatus: details.$metadata?.httpStatusCode,
    r2Code: details.Code ?? details.code,
    requestId: details.$metadata?.requestId,
  };
}

try {
  const client = new S3Client({
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
    endpoint: required('R2_ENDPOINT'),
    forcePathStyle: true,
    region: 'auto',
  });
  const bucket = required('R2_BUCKET');
  await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  process.stdout.write('ListObjectsV2: OK\n');

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: `supabase-backup-r2-probe-${randomUUID()}`,
      }),
    );
    process.stdout.write('HeadObject: unexpected existing probe key\n');
  } catch (error) {
    if (errorDetails(error).httpStatus !== NOT_FOUND_STATUS) throw error;
    process.stdout.write('HeadObject: OK (expected 404 for a new key)\n');
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(errorDetails(error), null, JSON_INDENTATION)}\n`,
  );
  process.exitCode = 1;
}
