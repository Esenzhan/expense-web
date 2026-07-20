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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      emoji TEXT NOT NULL,
      bg TEXT NOT NULL,
      fg TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0
    );
  `);
  for (const cat of SEED_CATEGORIES) {
    await pool.query(
      `INSERT INTO categories (name, emoji, bg, fg, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING`,
      [cat.name, cat.emoji, cat.bg, cat.fg, cat.sort]
    );
  }
}
