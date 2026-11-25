const mysql = require("mysql2/promise");
const { readFileSync } = require("node:fs");

const isProduction = process.env.NODE_ENV === "production";
const caPath = process.env.DB_SSL_CA_PATH;

if (isProduction && !caPath) {
  throw new Error("DB_SSL_CA_PATH is required when NODE_ENV is production.");
}

function readDatabaseCaCertificate(path) {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error("Unable to read the database CA certificate from DB_SSL_CA_PATH.", {
      cause: error
    });
  }
}

const ssl = caPath
  ? {
      ca: readDatabaseCaCertificate(caPath),
      rejectUnauthorized: true,
      verifyIdentity: true
    }
  : undefined;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ...(ssl ? { ssl } : {})
});

async function testDatabaseConnection() {
  const connection = await pool.getConnection();

  try {
    await connection.ping();
    return true;
  } finally {
    connection.release();
  }
}

module.exports = { pool, testDatabaseConnection };
