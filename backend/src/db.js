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
  // Idempotent for tables created before theme support existed. "system"
  // means "follow the OS" — the frontend resolves that case itself via
  // prefers-color-scheme, this column only matters for "light"/"dark".
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system'`);

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
  // Only for a genuinely fresh install (same reasoning as the categories
  // seed below): this used to run unconditionally on every boot, which
  // meant deleting a built-in wallet (e.g. "Ремонт" once a renovation is
  // done) got silently undone — empty and back — on the next deploy.
  const { rows: anyWallet } = await pool.query(`SELECT 1 FROM wallets LIMIT 1`);
  if (!anyWallet.length) {
    for (const wallet of SEED_WALLETS) {
      await pool.query(
        `INSERT INTO wallets (name, emoji, bg, fg, sort_order, shared)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (name) DO NOTHING`,
        [wallet.name, wallet.emoji, wallet.bg, wallet.fg, wallet.sort, wallet.shared]
      );
    }
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

  // Idempotent for expenses tables created before this existed. The offline
  // queue (frontend/src/offlineQueue.js) retries a create whenever it can't
  // tell "never reached the server" apart from "server saved it but the
  // response got lost" (a cold Render start is exactly that kind of flaky
  // window) — without a client-supplied key to dedup on, that retry becomes
  // a genuine second row. NULL for every other insert path (voice confirm,
  // receipt scan, backfill), which don't go through that retry loop.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS expenses_idempotency_key_idx
    ON expenses (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);

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
  // diverges from there); nothing is deleted. Detected by the column being
  // nullable — NOT NULL is only ever set once migration fully completes,
  // so this also catches (and safely retries) a boot that died mid-way.
  // Runs in one transaction: if any step fails, everything here rolls
  // back so the next boot retries cleanly instead of getting stuck half
  // migrated.
  const { rows: catWalletCol } = await pool.query(`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'categories' AND column_name = 'wallet'
  `);
  if (!catWalletCol.length || catWalletCol[0].is_nullable === "YES") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `ALTER TABLE categories ADD COLUMN IF NOT EXISTS wallet TEXT
         REFERENCES wallets(name) ON DELETE CASCADE ON UPDATE CASCADE`
      );
      // Old single-column uniqueness has to go BEFORE fanning categories
      // out to other wallets below, or the second wallet's copy of any
      // name collides with the first wallet's row.
      await client.query(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key`);
      await client.query(
        `ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_wallet_name_key`
      );
      await client.query(
        `ALTER TABLE categories ADD CONSTRAINT categories_wallet_name_key UNIQUE (wallet, name)`
      );

      const firstWallet = SEED_WALLETS[0].name;
      await client.query(`UPDATE categories SET wallet = $1 WHERE wallet IS NULL`, [firstWallet]);
      const { rows: existing } = await client.query(
        `SELECT name, emoji, bg, fg, sort_order FROM categories WHERE wallet = $1`,
        [firstWallet]
      );
      const { rows: otherWallets } = await client.query(
        `SELECT name FROM wallets WHERE name != $1`,
        [firstWallet]
      );
      for (const w of otherWallets) {
        for (const cat of existing) {
          await client.query(
            `INSERT INTO categories (name, emoji, bg, fg, sort_order, wallet)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (wallet, name) DO NOTHING`,
            [cat.name, cat.emoji, cat.bg, cat.fg, cat.sort_order, w.name]
          );
        }
      }
      await client.query(`ALTER TABLE categories ALTER COLUMN wallet SET NOT NULL`);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Only for a genuinely fresh install (categories table completely empty).
  // This used to run unconditionally on every boot — harmless the first
  // time, but "ON CONFLICT DO NOTHING" only stops duplicates, it doesn't
  // know the difference between "never existed" and "user deleted it". So
  // every server restart (i.e. every deploy) was silently resurrecting any
  // seed category someone had deliberately removed from a wallet.
  const { rows: anyCategory } = await pool.query(`SELECT 1 FROM categories LIMIT 1`);
  if (!anyCategory.length) {
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

  // Monthly spending limit per (wallet, category). Shared wallets (Семья/
  // Бизнес/Ремонт) get one limit for both accounts — user_id NULL; the
  // private "Личные" wallet gets one limit per account, since its spending
  // itself is already scoped per user. NULL isn't unique-constrainable the
  // normal way (Postgres treats every NULL as distinct), so the "one shared
  // row per category" rule needs its own partial index instead of folding
  // user_id into a single UNIQUE(...).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS category_limits (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      category TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      monthly_limit NUMERIC NOT NULL,
      FOREIGN KEY (wallet, category) REFERENCES categories (wallet, name)
        ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS category_limits_shared_uidx
      ON category_limits (wallet, category) WHERE user_id IS NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS category_limits_private_uidx
      ON category_limits (wallet, category, user_id) WHERE user_id IS NOT NULL;
  `);

  // "Money actually on this account" — a user-entered anchor (base_amount at
  // base_at), not a running total mutated on every expense CRUD (that would
  // need matching code in create/edit/delete/undo/offline-sync/bot-insert,
  // all separate paths into `expenses`). Instead the live balance is always
  // computed as base_amount minus the sum of this wallet's expenses created
  // AFTER base_at (see routes/walletBalances.js) — self-consistent no matter
  // how those expenses got there. Same shared/private split as
  // category_limits above, for the same reason (Личные is one row per
  // account, the rest are one shared row).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_balances (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL REFERENCES wallets(name) ON DELETE CASCADE ON UPDATE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      base_amount NUMERIC NOT NULL,
      base_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_balances_shared_uidx
      ON wallet_balances (wallet) WHERE user_id IS NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_balances_private_uidx
      ON wallet_balances (wallet, user_id) WHERE user_id IS NOT NULL;
  `);

  // Daily reminder ("did you forget to log an expense") settings — one row
  // per account. days uses ISO weekday numbers (1=Пн..7=Вс) to match "Первый
  // день недели: Понедельник" elsewhere in the app. last_sent_date dedupes
  // the cron tick (see routes/reminders.js) so a 10-minute poll interval
  // never double-sends within the same Almaty-local day.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminder_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT false,
      days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
      time TEXT NOT NULL DEFAULT '22:00',
      text TEXT NOT NULL DEFAULT 'Пора внести расходы и доходы.',
      last_sent_date DATE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // One row per subscribed device (Web Push endpoint). A user could in
  // theory have more than one (e.g. re-added to Home Screen) — send to all.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // One row per receipt photo sent to Claude Vision — logged regardless of
  // whether it turns out to be a real receipt, since the API call (and its
  // token cost) already happened. Used by services/receiptScans.js to cap
  // scans per user per Almaty-local day.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_scans (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scan_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS receipt_scans_user_date_idx ON receipt_scans (user_id, scan_date);
  `);

  // Audit trail for wallet_balances changes — every manual correction and
  // every transfer leg writes a row here, so a lost/corrupted base_amount
  // (bad edit, future bug) is always recoverable by reading back what it
  // used to be, without depending on any periodic snapshot job that could
  // itself silently fail to run. old_amount is null for a wallet's very
  // first balance entry (nothing to compare against yet). changed_by is
  // always set (even for shared wallets) so a shared wallet's history shows
  // which of the two accounts made each change.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS balance_history (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL REFERENCES wallets(name) ON DELETE CASCADE ON UPDATE CASCADE,
      old_amount NUMERIC,
      new_amount NUMERIC NOT NULL,
      reason TEXT NOT NULL DEFAULT 'manual',
      counterpart_wallet TEXT,
      changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS balance_history_wallet_idx ON balance_history (wallet, changed_at DESC);
  `);

  // Долги — "owed_to_us" (someone owes us) or "we_owe" (we owe someone).
  // `user_id NULL` = family-scoped (both accounts see/settle it, same split
  // as wallet_balances' shared row); set = personal to that account only.
  // `remaining` is the live "how much is left" figure — decremented by each
  // debt_payments row rather than recomputed from a SUM, since (unlike
  // expenses) payments never get edited/deleted after the fact, so there's
  // no drift risk from storing it directly, and it's what most reads need.
  // `wallet` is optional: only set when the loan/borrow actually moved
  // through a tracked account, in which case creating/paying it also
  // re-bases that wallet's balance (see routes/debts.js) so the site's
  // number doesn't drift from the real bank balance once money changes
  // hands for real.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS debts (
      id SERIAL PRIMARY KEY,
      direction TEXT NOT NULL CHECK (direction IN ('owed_to_us', 'we_owe')),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      counterparty TEXT NOT NULL,
      description TEXT,
      amount NUMERIC NOT NULL CHECK (amount > 0),
      remaining NUMERIC NOT NULL,
      wallet TEXT REFERENCES wallets(name) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ,
      due_date DATE
    );
  `);
  // Idempotent for the debts table created before due_date existed.
  await pool.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS due_date DATE`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS debts_status_idx ON debts (status, created_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS debt_payments (
      id SERIAL PRIMARY KEY,
      debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL CHECK (amount > 0),
      wallet TEXT REFERENCES wallets(name) ON DELETE SET NULL,
      changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS debt_payments_debt_idx ON debt_payments (debt_id, created_at);
  `);
}
