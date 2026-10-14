/**
 * Database adapter.
 *
 * One tiny interface over two engines, so the rest of the app never cares
 * which one is in use:
 *
 *   - PostgreSQL  when DATABASE_URL is set   (Neon, Supabase, Render, Railway,
 *                                              Vercel Postgres… — works on serverless)
 *   - SQLite      otherwise                  (a single file, zero setup — works on
 *                                              any host with a persistent disk)
 *
 * API:
 *   await db.query(sql, params)   -> { rows }          (use `?` placeholders)
 *   await db.tx(async (q) => …)   -> runs q(sql, params) inside one transaction
 *   db.dialect                    -> 'sqlite' | 'postgres'
 *
 * Write SQL once with `?` placeholders; the Postgres adapter rewrites them to $1, $2…
 */
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SQLITE_FILE = process.env.SQLITE_FILE || path.join(DATA_DIR, 'biscotti.db');

/* ------------------------------------------------------------------ */
/* PostgreSQL                                                          */
/* ------------------------------------------------------------------ */
function createPostgres() {
  const { Pool, types } = require('pg');
  // BIGINT (oid 20) comes back as a string by default; our timestamps/ids are safe as JS numbers.
  types.setTypeParser(20, (v) => parseInt(v, 10));

  // Providers append ?sslmode=require. Recent `pg` versions turn that into strict certificate
  // checking, which fails on some hosts (e.g. Supabase), so we read it ourselves and
  // configure TLS explicitly: encrypted, without pinning the provider's certificate authority.
  let connectionString = DATABASE_URL;
  let sslMode = null;
  try {
    const u = new URL(DATABASE_URL);
    sslMode = u.searchParams.get('sslmode');
    u.searchParams.delete('sslmode');
    connectionString = u.toString();
  } catch (_) { /* leave the string untouched */ }
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL);
  const useSsl = process.env.DATABASE_SSL !== 'false' && sslMode !== 'disable' && !isLocal;
  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    // Serverless platforms spin up many short-lived instances; keep each one small.
    max: process.env.VERCEL ? 2 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));

  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

  return {
    dialect: 'postgres',
    async query(sql, params = []) {
      const r = await pool.query(toPg(sql), params);
      return { rows: r.rows, rowCount: r.rowCount };
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const q = async (sql, params = []) => {
          const r = await client.query(toPg(sql), params);
          return { rows: r.rows, rowCount: r.rowCount };
        };
        const out = await fn(q);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be gone */ }
        throw err;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}

/* ------------------------------------------------------------------ */
/* SQLite                                                              */
/* ------------------------------------------------------------------ */
function createSqlite() {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(SQLITE_FILE), { recursive: true });
  const raw = new Database(SQLITE_FILE);
  raw.pragma('journal_mode = WAL');   // readers never block the writer; crash-safe
  raw.pragma('synchronous = NORMAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');  // wait instead of failing if another process holds the lock

  const cache = new Map();
  const exec = (sql, params = []) => {
    let stmt = cache.get(sql);
    if (!stmt) { stmt = raw.prepare(sql); cache.set(sql, stmt); }
    if (stmt.reader) return { rows: stmt.all(...params), rowCount: 0 };
    const info = stmt.run(...params);
    return { rows: [], rowCount: info.changes };
  };

  // better-sqlite3 is synchronous and uses ONE connection. Because our request
  // handlers are async, two requests could otherwise interleave statements inside
  // each other's transaction. A simple promise-chain mutex rules that out.
  let chain = Promise.resolve();
  const locked = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  return {
    dialect: 'sqlite',
    file: SQLITE_FILE,
    query: (sql, params) => locked(async () => exec(sql, params)),
    tx: (fn) => locked(async () => {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(async (sql, params) => exec(sql, params));
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        try { raw.exec('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
        throw err;
      }
    }),
    async close() { raw.close(); },
  };
}

/* Serverless hosts (Vercel) have a read-only, throw-away filesystem: a SQLite file there would
 * silently lose data. Refuse to start with a clear message instead of pretending to work. */
function createUnconfigured() {
  const fail = () => {
    const err = new Error('The database is not connected yet. In Vercel go to Settings → Environment Variables and add DATABASE_URL (a PostgreSQL connection string, e.g. from Neon), then redeploy.');
    err.status = 503; err.expose = true;
    throw err;
  };
  return { dialect: 'unconfigured', query: fail, tx: fail, close: async () => {} };
}

const db = DATABASE_URL ? createPostgres() : (process.env.VERCEL ? createUnconfigured() : createSqlite());

/* ------------------------------------------------------------------ */
/* Schema (idempotent — safe to run on every start)                    */
/* ------------------------------------------------------------------ */
const PG = db.dialect === 'postgres';
const AUTO_ID = PG ? 'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const BLOB = PG ? 'BYTEA' : 'BLOB';
const REAL = PG ? 'DOUBLE PRECISION' : 'REAL';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS categories (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     tagline     TEXT NOT NULL DEFAULT '',
     description TEXT NOT NULL DEFAULT '',
     image       TEXT NOT NULL DEFAULT '',
     tone        TEXT NOT NULL DEFAULT '',
     sort_order  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS products (
     id          ${AUTO_ID},
     category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
     name        TEXT NOT NULL,
     price       ${REAL} NOT NULL,
     tags        TEXT NOT NULL DEFAULT '[]',
     image       TEXT NOT NULL DEFAULT '',
     sort_order  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id, sort_order)`,
  `CREATE TABLE IF NOT EXISTS gallery (
     id         ${AUTO_ID},
     image      TEXT NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS media (
     id         TEXT PRIMARY KEY,
     mime       TEXT NOT NULL,
     data       ${BLOB} NOT NULL,
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS orders (
     id          ${AUTO_ID},
     received_at BIGINT NOT NULL,
     name        TEXT NOT NULL DEFAULT '',
     phone       TEXT NOT NULL DEFAULT '',
     occasion    TEXT NOT NULL DEFAULT '',
     needed_on   TEXT NOT NULL DEFAULT '',
     size        TEXT NOT NULL DEFAULT '',
     flavour     TEXT NOT NULL DEFAULT '',
     details     TEXT NOT NULL DEFAULT '',
     photo       TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS staff (
     id            INTEGER PRIMARY KEY,
     username      TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     email         TEXT NOT NULL DEFAULT '',
     is_default    INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS reset_tokens (
     token_hash TEXT PRIMARY KEY,
     expires_at BIGINT NOT NULL
   )`,
];

async function migrate() {
  if (PG) {
    // Several instances may boot at once (serverless cold starts, rolling deploys).
    // Postgres can throw spurious "duplicate key" errors when they all run
    // CREATE TABLE IF NOT EXISTS simultaneously, so take turns with an advisory lock.
    await db.tx(async (q) => {
      await q('SELECT pg_advisory_xact_lock(727273)');
      for (const stmt of SCHEMA) await q(stmt);
    });
    return;
  }
  for (const stmt of SCHEMA) await db.query(stmt);
}

module.exports = { db, migrate, DATABASE_URL, SQLITE_FILE };
