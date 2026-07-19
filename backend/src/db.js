import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      raw_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS expenses_created_at_idx ON expenses (created_at);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS expenses_wallet_idx ON expenses (wallet);
  `);
}
