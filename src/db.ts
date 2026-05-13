import { Pool, PoolClient, QueryResult } from 'pg';

export const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'invoicesmart',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function query(text: string, params?: any[]): Promise<QueryResult> {
  return pool.query(text, params);
}

export async function initSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        company_name VARCHAR(255),
        vat_number VARCHAR(50),
        address JSONB,
        phone VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        company_name VARCHAR(255),
        vat_number VARCHAR(50),
        address JSONB,
        phone VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
        invoice_number VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'draft',
        issue_date DATE,
        due_date DATE,
        sent_at TIMESTAMP WITH TIME ZONE,
        paid_at TIMESTAMP WITH TIME ZONE,
        subtotal DECIMAL(12,2) DEFAULT 0,
        tax_rate DECIMAL(5,2) DEFAULT 0,
        tax_amount DECIMAL(12,2) DEFAULT 0,
        discount_rate DECIMAL(5,2) DEFAULT 0,
        discount_amount DECIMAL(12,2) DEFAULT 0,
        retention_rate DECIMAL(5,2) DEFAULT 0,
        retention_amount DECIMAL(12,2) DEFAULT 0,
        cis_rate DECIMAL(5,2) DEFAULT 0,
        cis_amount DECIMAL(12,2) DEFAULT 0,
        total_amount DECIMAL(12,2) DEFAULT 0,
        amount_paid DECIMAL(12,2) DEFAULT 0,
        amount_due DECIMAL(12,2) DEFAULT 0,
        notes TEXT,
        terms TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS invoice_line_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity DECIMAL(12,4) DEFAULT 1,
        unit_price DECIMAL(12,2) DEFAULT 0,
        amount DECIMAL(12,2) DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        transaction_date DATE NOT NULL,
        category VARCHAR(255),
        description TEXT,
        payment_method VARCHAR(50),
        reference VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tax_rules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        rate DECIMAL(5,2) NOT NULL,
        type VARCHAR(50) DEFAULT 'vat',
        country VARCHAR(2),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id UUID NOT NULL,
        action VARCHAR(50) NOT NULL,
        old_values JSONB,
        new_values JSONB,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key VARCHAR(255) NOT NULL,
        value TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, key)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_invoice_id ON transactions(invoice_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tax_rules_user_id ON tax_rules(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);
    `);

    await client.query('COMMIT');
    console.log('Schema initialized successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Schema initialization failed:', err);
    throw err;
  } finally {
    client.release();
  }
}
