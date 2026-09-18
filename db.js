require('dotenv').config();
const mysql = require('mysql2/promise');

function boolEnv(name, fallback=false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return String(v).toLowerCase() === 'true';
}

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aru_ticketing',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: false,
  decimalNumbers: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

if (boolEnv('DB_SSL', false)) {
  config.ssl = { rejectUnauthorized: boolEnv('DB_SSL_REJECT_UNAUTHORIZED', true) };
}

const pool = mysql.createPool(config);

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

async function assertDatabaseReady() {
  await pool.query('SELECT 1 AS ok');
  const required = ['users','tickets','ticket_evidence','ticket_timeline','email_tokens','pics','sessions'];
  const [rows] = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = ?`,
    [config.database]
  );
  const found = new Set(rows.map(r => r.TABLE_NAME || r.table_name));
  const missing = required.filter(t => !found.has(t));
  if (missing.length) {
    const err = new Error(`Schema MySQL belum lengkap. Tabel yang belum ada: ${missing.join(', ')}. Import database/aru_ticketing_mysql.sql terlebih dahulu.`);
    err.code = 'ARU_SCHEMA_MISSING';
    throw err;
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, withTransaction, assertDatabaseReady, close, config };
