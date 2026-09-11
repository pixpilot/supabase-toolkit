import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

/** Starts a disposable PostgreSQL server with synthetic databases and no host mounts. */
export async function recoveryDatabase() {
  const container = `supabase-backup-test-${randomUUID()}`;
  const clients: Client[] = [];
  const docker = (args: string[]) => {
    const result = spawnSync('docker', args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return (args[0] === 'logs' ? result.stdout + result.stderr : result.stdout).trim();
  };
  docker([
    'run',
    '--detach',
    '--name',
    container,
    '--publish',
    '127.0.0.1::5432',
    '--user',
    'postgres',
    '--tmpfs',
    '/tmp:rw,size=512m',
    '--entrypoint',
    '/bin/sh',
    'public.ecr.aws/supabase/postgres:17.6.1.165',
    '-c',
    'initdb -D /tmp/review -U review --auth=trust --no-locale --encoding=UTF8 && echo "host all review 0.0.0.0/0 trust" >> /tmp/review/pg_hba.conf && exec postgres -D /tmp/review -c listen_addresses=0.0.0.0 -c port=5432 -c fsync=off -c shared_preload_libraries= -c logging_collector=off',
  ]);
  const stop = async () => {
    try {
      await Promise.all(clients.map(async (client) => client.end()));
    } finally {
      docker(['rm', '--force', '--volumes', container]);
    }
  };
  try {
    const port = Number(docker(['port', container, '5432/tcp']).split(':').at(-1));
    const url = (database: string) =>
      `postgresql://review:unused@127.0.0.1:${port}/${database}?sslmode=disable`;
    const connect = async (database: string) => {
      const client = new Client({
        connectionString: url(database),
        connectionTimeoutMillis: 1000,
      });
      try {
        await client.connect();
      } catch (error) {
        await client.end();
        throw error;
      }
      clients.push(client);
      return client;
    };
    let admin: Client | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        admin = await connect('postgres');
        break;
      } catch {
        await new Promise((resolve) => {
          setTimeout(resolve, 250);
        });
      }
    }
    if (!admin) throw new Error(docker(['logs', container]));
    await admin.query('CREATE ROLE api_anon');
    return {
      url,
      stop,
      async create(schema: string) {
        const database = `test_${randomUUID().replaceAll('-', '')}`;
        await admin.query(`CREATE DATABASE ${database}`);
        const db = await connect(database);
        await db.query(schema);
        return { db, url: url(database), confirmTarget: `127.0.0.1:${port}/${database}` };
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
