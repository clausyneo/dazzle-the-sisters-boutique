"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");
const { parseEnv } = require("node:util");

const TEST_DB_HOST = "gateway01.ap-southeast-1.prod.aws.tidbcloud.com";
const TEST_DB_PORT = 4000;
const TEST_DB_NAME = "dazzle_boutique_test";
const ENV_FILE = path.resolve(__dirname, "..", ".env.test");
const REQUIRED_KEYS = [
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "DB_SSL_CA_PATH"
];

class TestDatabaseSafetyError extends Error {}

function assertNoNodeEnvFileOverrides() {
  const options = [
    ...process.execArgv,
    process.env.NODE_OPTIONS || ""
  ].join(" ");
  const normalizedOptions = options.toLowerCase();
  if (
    normalizedOptions.includes("--env-file") ||
    normalizedOptions.includes("--require") ||
    normalizedOptions.includes("--import") ||
    /(?:^|\s)-r(?:\s|$)/i.test(options)
  ) {
    throw new TestDatabaseSafetyError(
      "Refusing to run with Node options that can load other environment files or code."
    );
  }
}

function readTestDatabaseConfig() {
  assertNoNodeEnvFileOverrides();

  if (typeof parseEnv !== "function") {
    throw new TestDatabaseSafetyError("This test requires Node.js 20.12 or newer.");
  }

  let contents;
  try {
    contents = readFileSync(ENV_FILE, "utf8");
  } catch {
    throw new TestDatabaseSafetyError("Cannot read .env.test. No database connection was attempted.");
  }

  const seenKeys = new Set();
  for (const line of contents.split(/\r?\n/)) {
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (assignment && REQUIRED_KEYS.includes(assignment[1])) {
      if (seenKeys.has(assignment[1])) {
        throw new TestDatabaseSafetyError("A required database key is duplicated in .env.test.");
      }
      seenKeys.add(assignment[1]);
    }
  }

  let config;
  try {
    config = parseEnv(contents);
  } catch {
    throw new TestDatabaseSafetyError("Could not parse .env.test. No database connection was attempted.");
  }

  const missingKeys = REQUIRED_KEYS.filter((key) => !config[key]?.trim());
  if (missingKeys.length) {
    throw new TestDatabaseSafetyError(
      `Fill these .env.test values first: ${missingKeys.join(", ")}.`
    );
  }

  if (
    config.DB_HOST !== TEST_DB_HOST ||
    config.DB_PORT !== String(TEST_DB_PORT) ||
    config.DB_NAME !== TEST_DB_NAME
  ) {
    throw new TestDatabaseSafetyError(
      "Refusing to connect: DB_HOST, DB_PORT, and DB_NAME must match the approved test target."
    );
  }

  if (
    config.DB_USER.includes("REPLACE_WITH") ||
    config.DB_PASSWORD.includes("REPLACE_WITH") ||
    config.DB_SSL_CA_PATH.includes("REPLACE_WITH")
  ) {
    throw new TestDatabaseSafetyError("Replace the .env.test placeholders before running.");
  }

  const caPath = config.DB_SSL_CA_PATH.trim();
  if (!path.isAbsolute(caPath)) {
    throw new TestDatabaseSafetyError(
      "DB_SSL_CA_PATH must be an absolute path to the configured TiDB CA certificate."
    );
  }

  let ca;
  try {
    ca = readFileSync(caPath);
  } catch {
    throw new TestDatabaseSafetyError(
      "Could not read the CA certificate specified by DB_SSL_CA_PATH."
    );
  }
  if (!ca.toString("utf8").includes("-----BEGIN CERTIFICATE-----")) {
    throw new TestDatabaseSafetyError("DB_SSL_CA_PATH must point to a PEM CA certificate.");
  }

  return {
    host: TEST_DB_HOST,
    port: TEST_DB_PORT,
    user: config.DB_USER.trim(),
    password: config.DB_PASSWORD,
    database: TEST_DB_NAME,
    caPath,
    connectTimeout: 10000,
    ssl: {
      ca,
      rejectUnauthorized: true,
      verifyIdentity: true
    }
  };
}

function applyTestDatabaseEnvironment(config) {
  process.env.NODE_ENV = "test";
  process.env.DB_HOST = config.host;
  process.env.DB_PORT = String(config.port);
  process.env.DB_USER = config.user;
  process.env.DB_PASSWORD = config.password;
  process.env.DB_NAME = config.database;
  process.env.DB_SSL_CA_PATH = config.caPath;
}

function databaseConnectionOptions(config) {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: config.connectTimeout,
    ssl: config.ssl
  };
}

function isSupportedTiDBVersion(version) {
  if (typeof version !== "string" || !/tidb/i.test(version)) return false;
  const match = version.match(/TiDB-v(\d+)\.(\d+)\.(\d+)/i) ||
    version.match(/v(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return false;

  const actual = match.slice(1).map(Number);
  const minimum = [8, 5, 3];
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

function verifyTlsPeer(connection) {
  const mysqlConnection = connection.connection || connection;
  const stream = mysqlConnection.stream;
  if (
    !stream ||
    stream.encrypted !== true ||
    stream.authorized !== true ||
    stream.remotePort !== TEST_DB_PORT
  ) {
    throw new TestDatabaseSafetyError(
      "TLS authorization or the approved database port could not be verified."
    );
  }

  const certificate = stream.getPeerCertificate(true);
  if (!certificate || !Object.keys(certificate).length ||
      tls.checkServerIdentity(TEST_DB_HOST, certificate)) {
    throw new TestDatabaseSafetyError(
      "The database TLS certificate does not verify the approved server identity."
    );
  }
}

async function verifyDatabaseTarget(connection) {
  verifyTlsPeer(connection);
  const [rows] = await connection.execute(
    `SELECT VERSION() AS server_version,
            DATABASE() AS database_name,
            @@GLOBAL.tidb_txn_mode AS global_mode,
            @@SESSION.tidb_txn_mode AS session_mode`
  );
  const identity = rows[0];
  if (!identity || identity.database_name !== TEST_DB_NAME) {
    throw new TestDatabaseSafetyError("Connected database is not the approved test database.");
  }

  const serverVersion = String(identity.server_version || "");
  if (!isSupportedTiDBVersion(serverVersion)) {
    throw new TestDatabaseSafetyError("The server is not TiDB v8.5.3 or newer.");
  }
  if (
    String(identity.global_mode).toLowerCase() !== "pessimistic" ||
    String(identity.session_mode).toLowerCase() !== "pessimistic"
  ) {
    throw new TestDatabaseSafetyError(
      "Both global and session TiDB transaction modes must be pessimistic."
    );
  }

  return {
    database: identity.database_name,
    serverVersion,
    globalMode: String(identity.global_mode),
    sessionMode: String(identity.session_mode)
  };
}

module.exports = {
  TEST_DB_HOST,
  TEST_DB_PORT,
  TEST_DB_NAME,
  TestDatabaseSafetyError,
  applyTestDatabaseEnvironment,
  databaseConnectionOptions,
  isSupportedTiDBVersion,
  readTestDatabaseConfig,
  verifyDatabaseTarget,
  verifyTlsPeer
};
