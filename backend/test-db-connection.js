"use strict";

const mysql = require("mysql2/promise");
const {
  TestDatabaseSafetyError,
  databaseConnectionOptions,
  readTestDatabaseConfig,
  verifyDatabaseTarget
} = require("./test-db-safety");

async function main() {
  let connection;
  try {
    const config = readTestDatabaseConfig();
    connection = await mysql.createConnection(databaseConnectionOptions(config));
    const identity = await verifyDatabaseTarget(connection);
    console.log(`TiDB version: ${identity.serverVersion}`);
    console.log(`Database: ${identity.database}`);
    console.log(
      `Transaction mode: global=${identity.globalMode}, session=${identity.sessionMode}`
    );
    console.log("TLS CA and server identity verification passed.");
    console.log("Read-only test connection check passed; no schema or data was changed.");
  } catch (error) {
    if (error instanceof TestDatabaseSafetyError) {
      console.error(error.message);
    } else {
      const code = typeof error.code === "string" ? ` (${error.code})` : "";
      console.error(
        `Test database connection check failed${code}. Verify the test connection and CA file; no credentials or connection strings were printed.`
      );
    }
    process.exitCode = 1;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        console.error("Could not close the test connection cleanly.");
        process.exitCode = 1;
      }
    }
  }
}

main();
