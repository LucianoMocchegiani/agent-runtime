import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from 'pg';

/**
 * Prepara la database antes del boot: la crea si no existe y aplica las migraciones.
 *
 * @remarks El CREATE DATABASE cubre volúmenes de Postgres ya existentes (el init de
 * `/docker-entrypoint-initdb.d` solo corre en el primer boot). Prisma hereda el env de este
 * proceso, así `--env-file` sirve también para `migrate deploy`.
 */
function adminConnectionString(databaseUrl: string): {
  adminUrl: string;
  databaseName: string;
} {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, '')).split(
    '/',
  )[0];
  if (!databaseName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseName)) {
    throw new Error('DATABASE_URL must include a simple database name');
  }
  url.pathname = '/postgres';
  return { adminUrl: url.toString(), databaseName };
}

async function ensureDatabase(databaseUrl: string): Promise<void> {
  const { adminUrl, databaseName } = adminConnectionString(databaseUrl);
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${databaseName}`);
    console.log(`Created database ${databaseName}`);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
    if (code !== '42P04') {
      throw error;
    }
  } finally {
    await client.end();
  }
}

function migrateDeploy(): void {
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed (exit ${result.status})`);
  }
}

async function setupDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('Missing required env DATABASE_URL');
  }
  await ensureDatabase(databaseUrl);
  migrateDeploy();
}

setupDatabase().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
