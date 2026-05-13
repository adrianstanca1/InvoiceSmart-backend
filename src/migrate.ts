import { Pool } from 'pg';
import { initSchema } from './db';

async function createDatabaseIfNotExists(): Promise<void> {
  const adminPool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'template1',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    connectionTimeoutMillis: 5000,
  });

  const dbName = process.env.DB_NAME || 'invoicesmart';

  try {
    const result = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (result.rowCount === 0) {
      console.log(`Database "${dbName}" does not exist. Creating...`);
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" created successfully.`);
    } else {
      console.log(`Database "${dbName}" already exists.`);
    }
  } catch (err) {
    console.error('Error checking/creating database:', err);
    throw err;
  } finally {
    await adminPool.end();
  }
}

async function migrate(): Promise<void> {
  await createDatabaseIfNotExists();
  await initSchema();
  console.log('Migration completed successfully.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
