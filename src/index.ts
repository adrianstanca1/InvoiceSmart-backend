import 'dotenv/config';
import { buildApp } from './app';
import { initSchema } from './db';

const app = buildApp();
const PORT = parseInt(process.env.PORT || '3002', 10);

async function start() {
  try {
    await initSchema();
    console.log('Database schema initialized');
  } catch (err) {
    console.error('Failed to initialize schema, continuing...', err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`InvoiceSmart API listening on http://0.0.0.0:${PORT}`);
  });
}

start();
