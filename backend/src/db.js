import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Default categories, inserted once on first boot. "Прочее" is pinned to the
// end via sort_order 999 — user-created categories slot in before it.
const SEED_CATEGORIES = [
  { name: "Кафе и рестораны", emoji: "🍴", bg: "#fde2e1", fg: "#c23b3b", sort: 1 },
  { name: "Продукты", emoji: "🛒", bg: "#e1f3e3", fg: "#2f8f4e", sort: 2 },
  { name: "Такси", emoji: "🚕", bg: "#fff2cf", fg: "#a9790a", sort: 3 },
  { name: "Транспорт", emoji: "🚌", bg: "#e3ecfd", fg: "#2f5fc2", sort: 4 },
  { name: "Связь и интернет", emoji: "📱", bg: "#eee3fd", fg: "#7440c2", sort: 5 },
  { name: "Развлечения", emoji: "🎮", bg: "#ffe6d1", fg: "#c2681f", sort: 6 },
  { name: "Здоровье", emoji: "💊", bg: "#d8f5f1", fg: "#1f9e8c", sort: 7 },
  { name: "Одежда", emoji: "👕", bg: "#fde1ef", fg: "#c23b8f", sort: 8 },
  { name: "Жильё", emoji: "🏠", bg: "#ece3d8", fg: "#8a6a3f", sort: 9 },
  { name: "Прочее", emoji: "💳", bg: "#e9e9ec", fg: "#5b5b63", sort: 999 },
];

// Default wallets — the four the Telegram bot used. "Личные" doubles as the
// voice-parse fallback and is the only private one — its expenses stay
// scoped to whoever logged them. The other three are shared: visible to
// and editable by both accounts, pooled in stats, mirrored to both
// personal Sheets.
const SEED_WALLETS = [
  { name: "Личные", emoji: "👛", bg: "#d7f5e9", fg: "#159969", sort: 1, shared: false },
  { name: "Семья", emoji: "👨‍👩‍👧", bg: "#e3ecfd", fg: "#2f5fc2", sort: 2, shared: true },
  { name: "Бизнес", emoji: "💼", bg: "#fde2e1", fg: "#c23b3b", sort: 3, shared: true },
  { name: "Ремонт", emoji: "🔨", bg: "#fff2cf", fg: "#a9790a", sort: 4, shared: true },
];

export async function initSchema() {
  // One row per logged-in Google account (only the two allowlisted emails
  // in practice — see ALLOWED_EMAILS). google_refresh_token is encrypted
  // at rest (see services/crypto.js) — needed to write to the user's own
  // Sheet without them being present (e.g. when the bot posts an expense).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      google_sub TEXT NOT NULL UNIQUE,
      avatar_url TEXT,
      google_refresh_token TEXT,
      sheet_id TEXT,
      bot_api_key TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // wallets before categories: categories.wallet references wallets(name).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      emoji TEXT NOT NULL,
      bg TEXT NOT NULL,
      fg TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      shared BOOLEAN NOT NULL DEFAULT true
    );
  `);
  // Idempotent for wallets tables created before "shared" existed.
  await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT true`);
  for (const wallet of SEED_WALLETS) {
    await pool.query(
      `INSERT INTO wallets (name, emoji, bg, fg, sort_order, shared)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (name) DO NOTHING`,
      [wallet.name, wallet.emoji, wallet.bg, wallet.fg, wallet.sort, wallet.shared]
    );
  }
  // "Личные" may already exist from before wallets could be private —
  // force it back to private every boot regardless of ON CONFLICT above.
  await pool.query(`UPDATE wallets SET shared = false WHERE name = 'Личные'`);

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

  // expenses.user_id — added when the app went multi-user. Pre-existing
  // rows were single-tenant test data with no owner, so they're dropped
  // rather than migrated (confirmed disposable).
  const { rows: userIdCol } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'user_id'
  `);
  if (!userIdCol.length) {
    await pool.query(`TRUNCATE expenses`);
    await pool.query(
      `ALTER TABLE expenses ADD COLUMN user_id INTEGER NOT NULL REFERENCES users(id)`
    );
    await pool.query(`CREATE INDEX IF NOT EXISTS expenses_user_id_idx ON expenses (user_id)`);
  }

  // categories: used to be one global list (UNIQUE on name alone). Fresh
  // installs get the per-wallet shape directly; existing tables are
  // migrated below.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      bg TEXT NOT NULL,
      fg TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      wallet TEXT NOT NULL REFERENCES wallets(name) ON DELETE CASCADE ON UPDATE CASCADE,
      UNIQUE (wallet, name)
    );
  `);

  // Pre-existing prod tables predate the "wallet" column — categories were
  // global. Migrate by fanning every existing row out to all wallets (each
  // wallet starts with its own independent copy of the same list, then
  // diverges from there); nothing is deleted.
  const { rows: catWalletCol } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'categories' AND column_name = 'wallet'
  `);
  if (!catWalletCol.length) {
    await pool.query(
      `ALTER TABLE categories ADD COLUMN wallet TEXT
       REFERENCES wallets(name) ON DELETE CASCADE ON UPDATE CASCADE`
    );
    const firstWallet = SEED_WALLETS[0].name;
    await pool.query(`UPDATE categories SET wallet = $1 WHERE wallet IS NULL`, [firstWallet]);
    const { rows: existing } = await pool.query(
      `SELECT name, emoji, bg, fg, sort_order FROM categories WHERE wallet = $1`,
      [firstWallet]
    );
    const { rows: otherWallets } = await pool.query(`SELECT name FROM wallets WHERE name != $1`, [
      firstWallet,
    ]);
    for (const w of otherWallets) {
      for (const cat of existing) {
        await pool.query(
          `INSERT INTO categories (name, emoji, bg, fg, sort_order, wallet)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [cat.name, cat.emoji, cat.bg, cat.fg, cat.sort_order, w.name]
        );
      }
    }
    await pool.query(`ALTER TABLE categories ALTER COLUMN wallet SET NOT NULL`);
    await pool.query(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key`);
    await pool.query(
      `ALTER TABLE categories ADD CONSTRAINT categories_wallet_name_key UNIQUE (wallet, name)`
    );
  }

  for (const wallet of SEED_WALLETS) {
    for (const cat of SEED_CATEGORIES) {
      await pool.query(
        `INSERT INTO categories (name, emoji, bg, fg, sort_order, wallet)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (wallet, name) DO NOTHING`,
        [cat.name, cat.emoji, cat.bg, cat.fg, cat.sort, wallet.name]
      );
    }
  }
}
