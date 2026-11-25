"use strict";

const { createHash, randomBytes, randomInt } = require("node:crypto");
const {
  TestDatabaseSafetyError,
  applyTestDatabaseEnvironment,
  readTestDatabaseConfig,
  verifyDatabaseTarget
} = require("./test-db-safety");
const {
  GARMENT_CATEGORIES,
  MEASUREMENT_FIELDS
} = require("./measurements");
const {
  createAdminAccount
} = require("./admin");

const EXPECTED_TABLES = [
  "admin_sessions",
  "admin_users",
  "customer_measurement_profiles",
  "customer_measurement_values",
  "customer_sessions",
  "customers"
];

const EXPECTED_COLUMNS = {
  customers: [
    "customer_id", "name", "phone", "email", "password_salt",
    "password_hash", "created_at", "updated_at"
  ],
  customer_sessions: [
    "session_id", "customer_id", "token_hash", "expires_at", "created_at"
  ],
  admin_users: [
    "admin_id", "username", "password_salt", "password_hash",
    "is_active", "created_at", "updated_at"
  ],
  admin_sessions: [
    "session_id", "admin_id", "token_hash", "expires_at", "created_at"
  ],
  customer_measurement_profiles: [
    "profile_id", "customer_id", "garment_category", "profile_name",
    "unit_preference", "fitting_preference", "notes", "last_updated_by_type",
    "last_updated_by_id", "created_at", "updated_at"
  ],
  customer_measurement_values: [
    "profile_id", "measurement_key", "value_cm"
  ]
};

const EXPECTED_INDEX_ENTRIES = [
  ["customers", "PRIMARY", 1, "customer_id"],
  ["customers", "uq_customers_phone", 1, "phone"],
  ["customers", "uq_customers_email", 1, "email"],
  ["customer_sessions", "PRIMARY", 1, "session_id"],
  ["customer_sessions", "uq_customer_sessions_token_hash", 1, "token_hash"],
  ["customer_sessions", "idx_customer_sessions_customer_id", 1, "customer_id"],
  ["customer_sessions", "idx_customer_sessions_expires_at", 1, "expires_at"],
  ["admin_users", "PRIMARY", 1, "admin_id"],
  ["admin_users", "uq_admin_users_username", 1, "username"],
  ["admin_sessions", "PRIMARY", 1, "session_id"],
  ["admin_sessions", "uq_admin_sessions_token_hash", 1, "token_hash"],
  ["admin_sessions", "idx_admin_sessions_admin_id", 1, "admin_id"],
  ["admin_sessions", "idx_admin_sessions_expires_at", 1, "expires_at"],
  ["customer_measurement_profiles", "PRIMARY", 1, "profile_id"],
  [
    "customer_measurement_profiles",
    "idx_measurement_profiles_customer_updated",
    1,
    "customer_id"
  ],
  [
    "customer_measurement_profiles",
    "idx_measurement_profiles_customer_updated",
    2,
    "updated_at"
  ],
  [
    "customer_measurement_profiles",
    "idx_measurement_profiles_customer_category",
    1,
    "customer_id"
  ],
  [
    "customer_measurement_profiles",
    "idx_measurement_profiles_customer_category",
    2,
    "garment_category"
  ],
  ["customer_measurement_profiles", "idx_measurement_profiles_category", 1, "garment_category"],
  ["customer_measurement_values", "PRIMARY", 1, "profile_id"],
  ["customer_measurement_values", "PRIMARY", 2, "measurement_key"]
];

const EXPECTED_COLUMN_TYPES = [
  ["customers", "customer_id", "bigint unsigned", true],
  ["customer_sessions", "customer_id", "bigint unsigned", false],
  ["admin_users", "admin_id", "bigint unsigned", true],
  ["admin_sessions", "admin_id", "bigint unsigned", false],
  ["customer_measurement_profiles", "profile_id", "bigint unsigned", true],
  ["customer_measurement_profiles", "customer_id", "bigint unsigned", false],
  ["customer_measurement_profiles", "last_updated_by_id", "bigint unsigned", false],
  ["customer_measurement_values", "profile_id", "bigint unsigned", false],
  ["customer_measurement_values", "value_cm", "decimal(8,3) unsigned", false]
];

const EXPECTED_FOREIGN_KEYS = [
  "admin_sessions|admin_id|admin_users|admin_id|CASCADE",
  "customer_measurement_profiles|customer_id|customers|customer_id|CASCADE",
  "customer_measurement_values|profile_id|customer_measurement_profiles|profile_id|CASCADE",
  "customer_sessions|customer_id|customers|customer_id|CASCADE"
];

const CUSTOMER_ORIGIN = "http://127.0.0.1:5500";
const CUSTOMER_COOKIE = "dazzle_session";
const ADMIN_COOKIE = "dazzle_admin_session";
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

class IntegrationFailure extends Error {}

function expect(condition, message) {
  if (!condition) throw new IntegrationFailure(message);
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) throw new IntegrationFailure(message);
}

function expectArrayEqual(actual, expected, message) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new IntegrationFailure(message);
  }
}

function createPassword(length) {
  return Array.from(
    { length },
    () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  ).join("");
}

function createIdentity(label, nonce) {
  const phone = `${randomInt(6, 10)}${Array.from(
    { length: 9 },
    () => randomInt(10)
  ).join("")}`;
  return {
    name: `RMS Integration ${label} ${nonce}`,
    phone,
    email: `rms-it-${label}-${nonce}@example.invalid`,
    customerId: null
  };
}

function isReadOnlyStatement(statement) {
  if (typeof statement !== "string") return false;
  const sql = statement.replace(/^\s*(?:(?:--[^\r\n]*|\/\*[\s\S]*?\*\/)\s*)*/, "");
  return /^SELECT\b/i.test(sql) &&
    !/\bFOR\s+UPDATE\b/i.test(sql) &&
    !/\bLOCK\s+IN\s+SHARE\s+MODE\b/i.test(sql);
}

function guardedConnection(connection) {
  return new Proxy(connection, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "execute" || property === "query") {
        return async (...args) => {
          if (!isReadOnlyStatement(args[0])) {
            await verifyDatabaseTarget(target);
          }
          return Reflect.apply(value, target, args);
        };
      }
      if (property === "beginTransaction" || property === "commit") {
        return async (...args) => {
          await verifyDatabaseTarget(target);
          return Reflect.apply(value, target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function guardedPool(pool) {
  return new Proxy(pool, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "getConnection") {
        return async () => guardedConnection(await target.getConnection());
      }
      if (property === "execute" || property === "query") {
        return async (...args) => {
          if (isReadOnlyStatement(args[0])) {
            return Reflect.apply(value, target, args);
          }
          const connection = await target.getConnection();
          try {
            await verifyDatabaseTarget(connection);
            return await connection[property](...args);
          } finally {
            connection.release();
          }
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

async function verifySchema(connection) {
  const [tableRows] = await connection.execute(
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
  );
  const tableNames = tableRows.map((row) => row.TABLE_NAME);
  expectArrayEqual(
    tableNames,
    EXPECTED_TABLES,
    "The test database must contain exactly the six expected integration tables."
  );
  expect(
    tableRows.every((row) =>
      row.ENGINE === "InnoDB" &&
      typeof row.TABLE_COLLATION === "string" &&
      row.TABLE_COLLATION.startsWith("utf8mb4_")
    ),
    "All six integration tables must use InnoDB and utf8mb4."
  );

  for (const [tableName, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [tableName]
    );
    expectArrayEqual(
      columns.map((column) => column.COLUMN_NAME),
      expectedColumns,
      `The ${tableName} column definition does not match the integration schema.`
    );
  }

  const [typeRows] = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  const actualTypes = new Map(typeRows.map((row) => [
    `${row.TABLE_NAME}|${row.COLUMN_NAME}`,
    {
      type: String(row.COLUMN_TYPE).toLowerCase(),
      autoIncrement: String(row.EXTRA).toLowerCase().includes("auto_increment")
    }
  ]));
  expect(
    EXPECTED_COLUMN_TYPES.every(([table, column, type, autoIncrement]) => {
      const actual = actualTypes.get(`${table}|${column}`);
      return actual &&
        actual.type === type &&
        actual.autoIncrement === autoIncrement;
    }),
    "A required customer, session, or measurement column type is incompatible."
  );

  const [indexRows] = await connection.execute(
    `SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  const actualIndexes = new Set(indexRows.map((row) =>
    `${row.TABLE_NAME}|${row.INDEX_NAME}|${Number(row.SEQ_IN_INDEX)}|${row.COLUMN_NAME}`
  ));
  expect(
    EXPECTED_INDEX_ENTRIES.every((entry) => actualIndexes.has(entry.join("|"))),
    "A required primary key or index is missing from the test schema."
  );

  const [foreignKeyRows] = await connection.execute(
    `SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
            k.REFERENCED_COLUMN_NAME, r.DELETE_RULE
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
     JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
      AND r.TABLE_NAME = k.TABLE_NAME
      AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.CONSTRAINT_SCHEMA = DATABASE()
       AND k.REFERENCED_TABLE_NAME IS NOT NULL`
  );
  const actualForeignKeys = foreignKeyRows.map((row) =>
    [
      row.TABLE_NAME,
      row.COLUMN_NAME,
      row.REFERENCED_TABLE_NAME,
      row.REFERENCED_COLUMN_NAME,
      String(row.DELETE_RULE).toUpperCase()
    ].join("|")
  ).sort();
  expectArrayEqual(
    actualForeignKeys,
    EXPECTED_FOREIGN_KEYS,
    "The test schema foreign keys or cascade rules do not match."
  );
}

async function countTableRows(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS row_count FROM \`${tableName}\``
  );
  return Number(rows[0].row_count);
}

async function assertEmptyTestTables(connection) {
  for (const tableName of EXPECTED_TABLES) {
    const count = await countTableRows(connection, tableName);
    if (count !== 0) {
      throw new TestDatabaseSafetyError(
        `Refusing to write: ${tableName} contains ${count} pre-existing row(s).`
      );
    }
  }
}

async function preflight(pool) {
  const connection = await pool.getConnection();
  try {
    const target = await verifyDatabaseTarget(connection);
    await verifySchema(connection);
    await assertEmptyTestTables(connection);
    return target;
  } finally {
    connection.release();
  }
}

function parseResponse(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new IntegrationFailure("The API returned an invalid JSON response.");
  }
}

function responseCookie(response, cookieName) {
  const setCookie = response.headers.get("set-cookie") || "";
  const firstPart = setCookie.split(";", 1)[0];
  const prefix = `${cookieName}=`;
  expect(firstPart.startsWith(prefix), "The expected session cookie was not issued.");
  const token = firstPart.slice(prefix.length);
  expect(/^[A-Za-z0-9_-]{43}$/.test(token), "The session cookie format was invalid.");
  return {
    token,
    cookie: `${cookieName}=${token}`,
    setCookie
  };
}

function cookieHas(cookie, attribute) {
  return cookie.toLowerCase().includes(attribute.toLowerCase());
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readFailure(error) {
  if (error instanceof IntegrationFailure ||
      error instanceof TestDatabaseSafetyError) {
    return error.message;
  }
  if (typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)) {
    return `database or runtime error (${error.code})`;
  }
  return "unexpected error; sensitive details were suppressed";
}

function createTestRunner(counts) {
  return async (suite, name, action) => {
    try {
      await action();
      counts[suite].passed += 1;
      console.log(`[PASS] ${suite}: ${name}`);
    } catch (error) {
      counts[suite].failed += 1;
      console.error(`[FAIL] ${suite}: ${name} — ${readFailure(error)}`);
    }
  };
}

function startLocalServer(createServer, databasePool) {
  const server = createServer({
    pool: databasePool,
    testDatabaseConnection: async () => true,
    frontendOrigin: CUSTOMER_ORIGIN,
    sendCustomerLoginNotification: async () => {},
    sendPasswordResetEmail: async () => {},
    sendOrderConfirmationEmail: async () => {},
    sendOrderStatusUpdateEmail: async () => {}
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || address.address !== "127.0.0.1") {
        server.close();
        reject(new TestDatabaseSafetyError("The integration server did not bind to loopback."));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function makeRequest(baseUrl) {
  return async (method, route, body, cookie) => {
    if (!route.startsWith("/api/")) {
      throw new IntegrationFailure("The integration client only permits local API routes.");
    }
    const headers = { origin: CUSTOMER_ORIGIN };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;

    let response;
    try {
      response = await fetch(`${baseUrl}${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new IntegrationFailure("The loopback HTTP request failed.");
    }

    let responseBody;
    try {
      responseBody = await response.text();
    } catch {
      throw new IntegrationFailure("The loopback HTTP response could not be read.");
    }
    return {
      status: response.status,
      headers: response.headers,
      body: responseBody
    };
  };
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function readProfileCount(databasePool, customerId) {
  const [rows] = await databasePool.execute(
    `SELECT COUNT(*) AS row_count
     FROM customer_measurement_profiles
     WHERE customer_id = ?`,
    [customerId]
  );
  return Number(rows[0].row_count);
}

async function readMeasurementValue(databasePool, profileId, key) {
  const [rows] = await databasePool.execute(
    `SELECT value_cm
     FROM customer_measurement_values
     WHERE profile_id = ? AND measurement_key = ?`,
    [profileId, key]
  );
  return rows.length ? Number(rows[0].value_cm) : null;
}

async function runIntegrationTests(databasePool, serverInfo, fixtures, counts) {
  const run = createTestRunner(counts);
  const request = makeRequest(serverInfo.baseUrl);
  const customerIdentities = fixtures.customerIdentities;
  const owner = fixtures.owner;
  const otherCustomer = fixtures.otherCustomer;
  const profileIds = {};
  const nonce = fixtures.nonce;

  await run("customer", "registration and password boundaries", async () => {
    const ownerRegistration = await request("POST", "/api/account/register", {
      name: owner.name,
      phone: owner.phone,
      email: owner.email,
      password: owner.password
    });
    expectEqual(ownerRegistration.status, 200, "The 7-character password registration failed.");
    const ownerBody = parseResponse(ownerRegistration);
    owner.customerId = Number(ownerBody.customer.customerId);
    owner.registrationCookie = responseCookie(ownerRegistration, CUSTOMER_COOKIE).cookie;
    expect(
      cookieHas(ownerRegistration.headers.get("set-cookie") || "", "HttpOnly") &&
      cookieHas(ownerRegistration.headers.get("set-cookie") || "", "SameSite=Lax"),
      "The customer registration cookie security attributes were missing."
    );

    const otherRegistration = await request("POST", "/api/account/register", {
      name: otherCustomer.name,
      phone: otherCustomer.phone,
      email: otherCustomer.email,
      password: otherCustomer.password
    });
    expectEqual(otherRegistration.status, 200, "The 16-character password registration failed.");
    otherCustomer.customerId = Number(parseResponse(otherRegistration).customer.customerId);
    otherCustomer.registrationCookie =
      responseCookie(otherRegistration, CUSTOMER_COOKIE).cookie;

    for (const fixture of customerIdentities.filter((entry) => entry.invalidPasswordLength)) {
      const response = await request("POST", "/api/account/register", {
        name: fixture.name,
        phone: fixture.phone,
        email: fixture.email,
        password: fixture.password
      });
      expectEqual(
        response.status,
        400,
        `A ${fixture.password.length}-character registration password was not rejected.`
      );
    }
  });

  await run("customer", "login, authentication, and hashed session cookie", async () => {
    const login = await request("POST", "/api/account/login", {
      identifier: owner.email,
      password: owner.password
    });
    expectEqual(login.status, 200, "Customer login failed.");
    const session = responseCookie(login, CUSTOMER_COOKIE);
    owner.loginCookie = session.cookie;
    expect(
      cookieHas(session.setCookie, "HttpOnly") &&
      cookieHas(session.setCookie, "SameSite=Lax") &&
      cookieHas(session.setCookie, "Max-Age=604800"),
      "Customer login cookie attributes were incorrect."
    );
    const me = await request("GET", "/api/account/me", undefined, owner.loginCookie);
    expectEqual(me.status, 200, "The customer session did not authenticate.");
    expectEqual(parseResponse(me).customer.customerId, owner.customerId,
      "The customer session resolved to the wrong account.");

    const [sessions] = await databasePool.execute(
      `SELECT token_hash
       FROM customer_sessions
       WHERE customer_id = ? AND token_hash = ?`,
      [owner.customerId, sha256(session.token)]
    );
    expectEqual(sessions.length, 1, "The customer session token was not stored as a hash.");
  });

  await run("customer", "unauthenticated measurement requests are rejected", async () => {
    const list = await request("GET", "/api/account/measurement-profiles");
    const create = await request("POST", "/api/account/measurement-profiles", {
      garmentCategory: "BLOUSE",
      profileName: `Unauthenticated ${nonce}`,
      measurements: { bust: 36 }
    });
    expectEqual(list.status, 401, "An unauthenticated profile list request was accepted.");
    expectEqual(create.status, 401, "An unauthenticated profile create request was accepted.");
    expectEqual(
      await readProfileCount(databasePool, owner.customerId),
      0,
      "An unauthenticated request wrote a measurement profile."
    );
  });

  await run("customer", "six categories, profile CRUD, and centimetre/inch storage", async () => {
    for (const category of GARMENT_CATEGORIES) {
      const measurementKey = MEASUREMENT_FIELDS[category][0];
      const isBlouse = category === "BLOUSE";
      const profileName = `RMS ${nonce} ${category}`;
      const response = await request(
        "POST",
        "/api/account/measurement-profiles",
        {
          garmentCategory: category,
          profileName,
          unitPreference: isBlouse ? "in" : "cm",
          fittingPreference: "REGULAR",
          notes: `Synthetic integration profile ${nonce}`,
          measurements: { [measurementKey]: isBlouse ? 36 : 55 }
        },
        owner.loginCookie
      );
      expectEqual(response.status, 201, `Profile creation failed for ${category}.`);
      const profile = parseResponse(response).profile;
      profileIds[category] = Number(profile.profileId);
      expectEqual(profile.garmentCategory, category, `The ${category} category was not retained.`);
      expect(
        Number.isFinite(Date.parse(profile.createdAt)) &&
        Number.isFinite(Date.parse(profile.updatedAt)),
        `The ${category} profile timestamps were missing or invalid.`
      );
      if (isBlouse) {
        expectEqual(profile.measurements.bust, 36, "The inch value was not returned in inches.");
        expectEqual(
          await readMeasurementValue(databasePool, profileIds[category], "bust"),
          91.44,
          "The inch value was not stored canonically as 91.44 centimetres."
        );
      }
    }

    const listing = await request(
      "GET",
      "/api/account/measurement-profiles",
      undefined,
      owner.loginCookie
    );
    expectEqual(listing.status, 200, "The customer profile list request failed.");
    const listedProfiles = parseResponse(listing).profiles;
    expectEqual(listedProfiles.length, GARMENT_CATEGORIES.length,
      "The customer profile list did not contain all six categories.");
    for (const category of GARMENT_CATEGORIES) {
      expect(
        listedProfiles.some((profile) => profile.garmentCategory === category),
        `The customer profile list omitted ${category}.`
      );
    }

    const viewed = await request(
      "GET",
      `/api/account/measurement-profiles/${profileIds.KURTI}`,
      undefined,
      owner.loginCookie
    );
    expectEqual(viewed.status, 200, "The customer could not read an owned profile.");
    expectEqual(parseResponse(viewed).profile.garmentCategory, "KURTI",
      "The profile read returned the wrong category.");

    const updatedName = `RMS ${nonce} Customer Updated`;
    const updated = await request(
      "PATCH",
      `/api/account/measurement-profiles/${profileIds.KURTI}`,
      {
        profileName: updatedName,
        fittingPreference: "SNUG",
        notes: `Customer edit ${nonce}`
      },
      owner.loginCookie
    );
    expectEqual(updated.status, 200, "The customer profile update failed.");
    expectEqual(parseResponse(updated).profile.profileName, updatedName,
      "The customer profile name was not updated.");
    expectEqual(parseResponse(updated).profile.lastUpdatedBy, "CUSTOMER",
      "The customer edit was attributed to the wrong actor.");
    fixtures.updatedProfileName = updatedName;

    const converted = await request(
      "PATCH",
      `/api/account/measurement-profiles/${profileIds.BLOUSE}`,
      { unitPreference: "cm" },
      owner.loginCookie
    );
    expectEqual(converted.status, 200, "Changing the profile display unit failed.");
    expectEqual(parseResponse(converted).profile.measurements.bust, 91.44,
      "Changing the display unit did not return the canonical centimetre value.");
    expectEqual(
      await readMeasurementValue(databasePool, profileIds.BLOUSE, "bust"),
      91.44,
      "Changing display units modified the canonical stored measurement."
    );

    const disposable = await request(
      "POST",
      "/api/account/measurement-profiles",
      {
        garmentCategory: "BLOUSE",
        profileName: `RMS ${nonce} Delete Check`,
        measurements: { bust: 34 }
      },
      owner.loginCookie
    );
    expectEqual(disposable.status, 201, "The disposable profile could not be created.");
    const disposableId = Number(parseResponse(disposable).profile.profileId);
    const deleted = await request(
      "DELETE",
      `/api/account/measurement-profiles/${disposableId}`,
      undefined,
      owner.loginCookie
    );
    expectEqual(deleted.status, 200, "The customer profile delete failed.");
    const [remainingValues] = await databasePool.execute(
      "SELECT profile_id FROM customer_measurement_values WHERE profile_id = ?",
      [disposableId]
    );
    expectEqual(remainingValues.length, 0,
      "Deleting a profile did not cascade to its measurement values.");
    const [remainingProfile] = await databasePool.execute(
      "SELECT profile_id FROM customer_measurement_profiles WHERE profile_id = ?",
      [disposableId]
    );
    expectEqual(remainingProfile.length, 0, "The deleted profile remains in the database.");
  });

  await run("customer", "invalid measurement inputs are rejected without writes", async () => {
    const beforeProfiles = await readProfileCount(databasePool, owner.customerId);
    const [beforeValues] = await databasePool.execute(
      `SELECT COUNT(*) AS row_count
       FROM customer_measurement_values v
       JOIN customer_measurement_profiles p ON p.profile_id = v.profile_id
       WHERE p.customer_id = ?`,
      [owner.customerId]
    );
    const base = {
      garmentCategory: "BLOUSE",
      profileName: `RMS ${nonce} Invalid`,
      measurements: { bust: 36 }
    };
    const invalidBodies = [
      { ...base, garmentCategory: "NOT_A_CATEGORY" },
      { ...base, measurements: { unsupported_measurement: 36 } },
      { ...base, measurements: { bust: 401 } },
      { ...base, unitPreference: "feet" },
      { ...base, fittingPreference: "TIGHT" },
      { ...base, unsupportedField: true }
    ];
    for (const body of invalidBodies) {
      const response = await request(
        "POST",
        "/api/account/measurement-profiles",
        body,
        owner.loginCookie
      );
      expectEqual(response.status, 400, "Invalid profile input was accepted.");
    }
    expectEqual(
      await readProfileCount(databasePool, owner.customerId),
      beforeProfiles,
      "Invalid input created a measurement profile."
    );
    const [afterValues] = await databasePool.execute(
      `SELECT COUNT(*) AS row_count
       FROM customer_measurement_values v
       JOIN customer_measurement_profiles p ON p.profile_id = v.profile_id
       WHERE p.customer_id = ?`,
      [owner.customerId]
    );
    expectEqual(Number(afterValues[0].row_count), Number(beforeValues[0].row_count),
      "Invalid input wrote measurement values.");
  });

  await run("customer", "customer ownership isolation", async () => {
    const profileId = profileIds.BLOUSE;
    const foreignGet = await request(
      "GET",
      `/api/account/measurement-profiles/${profileId}`,
      undefined,
      otherCustomer.registrationCookie
    );
    const foreignPatch = await request(
      "PATCH",
      `/api/account/measurement-profiles/${profileId}`,
      { notes: "unauthorized edit" },
      otherCustomer.registrationCookie
    );
    const foreignDelete = await request(
      "DELETE",
      `/api/account/measurement-profiles/${profileId}`,
      undefined,
      otherCustomer.registrationCookie
    );
    expectEqual(foreignGet.status, 404, "A foreign customer read an owned profile.");
    expectEqual(foreignPatch.status, 404, "A foreign customer updated an owned profile.");
    expectEqual(foreignDelete.status, 404, "A foreign customer deleted an owned profile.");
    const ownerRead = await request(
      "GET",
      `/api/account/measurement-profiles/${profileId}`,
      undefined,
      owner.loginCookie
    );
    expectEqual(ownerRead.status, 200, "The owner lost access after a foreign request.");
  });

  await run("customer", "20-profile limit under concurrent requests and 21st rejection", async () => {
    let count = await readProfileCount(databasePool, owner.customerId);
    let sequence = 0;
    while (count < 19) {
      sequence += 1;
      const response = await request(
        "POST",
        "/api/account/measurement-profiles",
        {
          garmentCategory: "BLOUSE",
          profileName: `RMS ${nonce} Limit ${sequence}`,
          measurements: { bust: 32 }
        },
        owner.loginCookie
      );
      expectEqual(response.status, 201, "Could not prepare 19 profiles for the concurrency test.");
      count = await readProfileCount(databasePool, owner.customerId);
    }
    expectEqual(count, 19, "The concurrency test did not start with exactly 19 profiles.");

    const concurrentResponses = await Promise.all(
      [1, 2, 3].map((attempt) => request(
        "POST",
        "/api/account/measurement-profiles",
        {
          garmentCategory: "BLOUSE",
          profileName: `RMS ${nonce} Concurrent ${attempt}`,
          measurements: { bust: 33 }
        },
        owner.loginCookie
      ))
    );
    const statuses = concurrentResponses.map((response) => response.status).sort();
    expectArrayEqual(statuses, [201, 409, 409],
      "Concurrent profile creation did not admit exactly one 20th profile.");
    expectEqual(
      await readProfileCount(databasePool, owner.customerId),
      20,
      "Concurrent profile creation exceeded or failed to reach the 20-profile limit."
    );

    const twentyFirst = await request(
      "POST",
      "/api/account/measurement-profiles",
      {
        garmentCategory: "BLOUSE",
        profileName: `RMS ${nonce} 21st`,
        measurements: { bust: 35 }
      },
      owner.loginCookie
    );
    expectEqual(twentyFirst.status, 409, "The 21st profile was not rejected.");
    expectEqual(
      await readProfileCount(databasePool, owner.customerId),
      20,
      "The profile count changed after the rejected 21st create."
    );
  });

  await run("admin", "synthetic admin creation uses the application scrypt function", async () => {
    const result = await createAdminAccount(
      databasePool,
      fixtures.admin.username,
      fixtures.admin.password
    );
    fixtures.admin.adminId = Number(result.adminId);
    const [rows] = await databasePool.execute(
      `SELECT password_salt, password_hash
       FROM admin_users
       WHERE admin_id = ? AND username = ?`,
      [fixtures.admin.adminId, fixtures.admin.username]
    );
    expectEqual(rows.length, 1, "The synthetic admin account was not stored.");
    expect(/^[a-f0-9]{32}$/i.test(rows[0].password_salt),
      "The synthetic admin salt has an invalid format.");
    expect(/^[a-f0-9]{128}$/i.test(rows[0].password_hash),
      "The synthetic admin scrypt hash has an invalid format.");
    expect(rows[0].password_hash !== fixtures.admin.password,
      "The synthetic admin password was stored as plaintext.");
  });

  await run("admin", "admin login and hashed session cookie", async () => {
    const login = await request("POST", "/api/admin/login", {
      username: fixtures.admin.username,
      password: fixtures.admin.password
    });
    expectEqual(login.status, 200, "Admin login failed.");
    const session = responseCookie(login, ADMIN_COOKIE);
    fixtures.admin.loginCookie = session.cookie;
    expect(
      cookieHas(session.setCookie, "HttpOnly") &&
      cookieHas(session.setCookie, "SameSite=Strict") &&
      cookieHas(session.setCookie, "Max-Age=28800"),
      "The admin cookie security attributes were missing."
    );
    const current = await request("GET", "/api/admin/me", undefined, session.cookie);
    expectEqual(current.status, 200, "The admin session did not authenticate.");
    expectEqual(parseResponse(current).admin.adminId, fixtures.admin.adminId,
      "The admin session resolved to the wrong account.");

    const [sessions] = await databasePool.execute(
      `SELECT token_hash
       FROM admin_sessions
       WHERE admin_id = ? AND token_hash = ?`,
      [fixtures.admin.adminId, sha256(session.token)]
    );
    expectEqual(sessions.length, 1, "The admin session token was not stored as a hash.");
  });

  await run("admin", "search, category filter, pagination, and profile read", async () => {
    const searchFor = async (term) => {
      const query = new URLSearchParams({ search: term });
      const response = await request(
        "GET",
        `/api/admin/measurement-profiles?${query}`,
        undefined,
        fixtures.admin.loginCookie
      );
      expectEqual(response.status, 200, "An admin profile search failed.");
      const profiles = parseResponse(response).profiles;
      expect(
        profiles.some((profile) => profile.customer.customerId === owner.customerId),
        "An admin search did not return the synthetic customer."
      );
    };
    await searchFor(owner.name);
    await searchFor(owner.phone);
    await searchFor(fixtures.updatedProfileName);

    const categoryQuery = new URLSearchParams({ garmentCategory: "LEHENGA" });
    const categoryResponse = await request(
      "GET",
      `/api/admin/measurement-profiles?${categoryQuery}`,
      undefined,
      fixtures.admin.loginCookie
    );
    expectEqual(categoryResponse.status, 200, "The admin category filter failed.");
    const categoryProfiles = parseResponse(categoryResponse).profiles;
    expect(
      categoryProfiles.some((profile) => profile.garmentCategory === "LEHENGA"),
      "The admin category filter omitted the requested category."
    );

    const pageOne = await request(
      "GET",
      "/api/admin/measurement-profiles?page=1&pageSize=2",
      undefined,
      fixtures.admin.loginCookie
    );
    const pageTwo = await request(
      "GET",
      "/api/admin/measurement-profiles?page=2&pageSize=2",
      undefined,
      fixtures.admin.loginCookie
    );
    expectEqual(pageOne.status, 200, "Admin pagination page one failed.");
    expectEqual(pageTwo.status, 200, "Admin pagination page two failed.");
    const firstPage = parseResponse(pageOne);
    const secondPage = parseResponse(pageTwo);
    expectEqual(firstPage.profiles.length, 2, "Page one did not contain two profiles.");
    expectEqual(secondPage.profiles.length, 2, "Page two did not contain two profiles.");
    expect(
      firstPage.pagination.totalPages > 1 &&
      firstPage.profiles.every((profile) =>
        !secondPage.profiles.some((other) => other.profileId === profile.profileId)
      ),
      "Admin pagination metadata or page boundaries were incorrect."
    );

    const detail = await request(
      "GET",
      `/api/admin/measurement-profiles/${profileIds.BLOUSE}`,
      undefined,
      fixtures.admin.loginCookie
    );
    expectEqual(detail.status, 200, "The admin could not read a measurement profile.");
    expectEqual(parseResponse(detail).profile.profileId, profileIds.BLOUSE,
      "The admin profile detail returned the wrong record.");
  });

  await run("admin", "admin edits are attributed and visible in the customer book", async () => {
    const updatedName = `RMS ${nonce} Admin Updated`;
    const response = await request(
      "PATCH",
      `/api/admin/measurement-profiles/${profileIds.BLOUSE}`,
      {
        profileName: updatedName,
        unitPreference: "cm",
        fittingPreference: "RELAXED",
        notes: `Admin edit ${nonce}`,
        measurements: { bust: 100 }
      },
      fixtures.admin.loginCookie
    );
    expectEqual(response.status, 200, "The admin profile update failed.");
    const updated = parseResponse(response).profile;
    expectEqual(updated.profileName, updatedName, "The admin profile name was not updated.");
    expectEqual(updated.lastUpdatedBy, "ADMIN", "The admin update actor was not recorded.");

    const [attribution] = await databasePool.execute(
      `SELECT last_updated_by_type, last_updated_by_id
       FROM customer_measurement_profiles
       WHERE profile_id = ?`,
      [profileIds.BLOUSE]
    );
    expectEqual(attribution[0].last_updated_by_type, "ADMIN",
      "The database did not record an admin update.");
    expectEqual(Number(attribution[0].last_updated_by_id), fixtures.admin.adminId,
      "The database recorded the wrong admin ID.");
    expectEqual(await readMeasurementValue(databasePool, profileIds.BLOUSE, "bust"),
      100, "The admin measurement edit was not persisted in centimetres.");

    const book = await request(
      "GET",
      "/api/account/measurement-profiles",
      undefined,
      owner.loginCookie
    );
    expectEqual(book.status, 200, "The customer Measurement Book request failed.");
    const customerProfile = parseResponse(book).profiles.find(
      (profile) => profile.profileId === profileIds.BLOUSE
    );
    expect(customerProfile, "The customer Measurement Book omitted the edited profile.");
    expectEqual(customerProfile.profileName, updatedName,
      "The customer Measurement Book did not reflect the admin edit.");
    expectEqual(customerProfile.measurements.bust, 100,
      "The customer Measurement Book showed stale measurements.");
  });

  await run("admin", "unauthenticated and customer sessions cannot access admin APIs", async () => {
    const unauthenticated = await request(
      "GET",
      "/api/admin/measurement-profiles",
      undefined
    );
    const customerSession = await request(
      "GET",
      "/api/admin/measurement-profiles",
      undefined,
      owner.loginCookie
    );
    expectEqual(unauthenticated.status, 401, "An unauthenticated admin request was accepted.");
    expectEqual(customerSession.status, 401, "A customer session accessed an admin API.");
  });

  await run("admin", "admin logout revokes the session", async () => {
    const logout = await request(
      "POST",
      "/api/admin/logout",
      undefined,
      fixtures.admin.loginCookie
    );
    expectEqual(logout.status, 200, "Admin logout failed.");
    expect(
      cookieHas(logout.headers.get("set-cookie") || "", "Max-Age=0"),
      "Admin logout did not clear the session cookie."
    );
    const afterLogout = await request(
      "GET",
      "/api/admin/me",
      undefined,
      fixtures.admin.loginCookie
    );
    expectEqual(afterLogout.status, 401, "The admin session remained valid after logout.");
  });

  await run("customer", "customer logout revokes the session", async () => {
    const logout = await request(
      "POST",
      "/api/account/logout",
      undefined,
      owner.loginCookie
    );
    expectEqual(logout.status, 200, "Customer logout failed.");
    expect(
      cookieHas(logout.headers.get("set-cookie") || "", "Max-Age=0"),
      "Customer logout did not clear the session cookie."
    );
    const afterLogout = await request(
      "GET",
      "/api/account/me",
      undefined,
      owner.loginCookie
    );
    expectEqual(afterLogout.status, 401, "The customer session remained valid after logout.");
  });
}

async function cleanupSyntheticRows(databasePool, fixtures) {
  const problems = [];

  for (const fixture of fixtures.customerIdentities) {
    try {
      const [rows] = await databasePool.execute(
        `SELECT customer_id, name
         FROM customers
         WHERE email = ? AND phone = ?`,
        [fixture.email, fixture.phone]
      );
      if (rows.length > 1) {
        problems.push("multiple rows matched one synthetic customer identity");
        continue;
      }
      if (!rows.length) continue;
      const row = rows[0];
      if (row.name !== fixture.name ||
          (fixture.customerId !== null &&
            Number(row.customer_id) !== fixture.customerId)) {
        problems.push("a customer identity did not match its synthetic fixture");
        continue;
      }
      const [result] = await databasePool.execute(
        `DELETE FROM customers
         WHERE customer_id = ? AND email = ? AND phone = ? AND name = ?`,
        [row.customer_id, fixture.email, fixture.phone, fixture.name]
      );
      if (result.affectedRows !== 1) {
        problems.push("a synthetic customer row was not deleted");
      }
    } catch (error) {
      problems.push(readFailure(error));
    }
  }

  try {
    const [rows] = await databasePool.execute(
      "SELECT admin_id FROM admin_users WHERE username = ?",
      [fixtures.admin.username]
    );
    if (rows.length > 1) {
      problems.push("multiple rows matched the synthetic admin username");
    } else if (rows.length === 1) {
      const adminId = Number(rows[0].admin_id);
      if (fixtures.admin.adminId !== null && adminId !== fixtures.admin.adminId) {
        problems.push("the admin ID did not match its synthetic fixture");
      } else {
        const [result] = await databasePool.execute(
          "DELETE FROM admin_users WHERE admin_id = ? AND username = ?",
          [adminId, fixtures.admin.username]
        );
        if (result.affectedRows !== 1) {
          problems.push("the synthetic admin row was not deleted");
        }
      }
    }
  } catch (error) {
    problems.push(readFailure(error));
  }

  for (const tableName of EXPECTED_TABLES) {
    try {
      const count = await countTableRows(databasePool, tableName);
      if (count !== 0) problems.push(`${tableName} still contains ${count} row(s)`);
    } catch (error) {
      problems.push(`${tableName} could not be verified (${readFailure(error)})`);
    }
  }

  if (problems.length) {
    throw new IntegrationFailure(`Cleanup could not be verified: ${problems.join("; ")}.`);
  }
}

async function main() {
  const counts = {
    customer: { passed: 0, failed: 0 },
    admin: { passed: 0, failed: 0 }
  };
  let totalFailures = 0;
  let cleanupStatus = "not run (safety preflight did not pass)";
  let rawPool;
  let databasePool;
  let server;
  let preflightPassed = false;
  let fixtures;

  try {
    const config = readTestDatabaseConfig();
    applyTestDatabaseEnvironment(config);

    rawPool = require("./database").pool;
    databasePool = guardedPool(rawPool);
    const target = await preflight(rawPool);
    preflightPassed = true;
    console.log(
      `Safety checks passed: ${target.database}, TiDB ${target.serverVersion}, ` +
      `global/session ${target.globalMode}, TLS identity verified.`
    );
    console.log("Preflight passed: exactly six expected tables exist and all are empty.");

    const nonce = randomBytes(8).toString("hex");
    const owner = {
      ...createIdentity("owner", nonce),
      password: createPassword(7),
      loginCookie: null,
      registrationCookie: null
    };
    const otherCustomer = {
      ...createIdentity("other", nonce),
      password: createPassword(16),
      loginCookie: null,
      registrationCookie: null
    };
    const invalidSix = {
      ...createIdentity("invalid-six", nonce),
      password: createPassword(6),
      invalidPasswordLength: true
    };
    const invalidSeventeen = {
      ...createIdentity("invalid-seventeen", nonce),
      password: createPassword(17),
      invalidPasswordLength: true
    };
    fixtures = {
      nonce,
      owner,
      otherCustomer,
      customerIdentities: [owner, otherCustomer, invalidSix, invalidSeventeen],
      admin: {
        username: `rms-it-${nonce}`,
        password: createPassword(14),
        adminId: null,
        loginCookie: null
      }
    };

    let serverInfo;
    try {
      const application = require("./server");
      serverInfo = await startLocalServer(application.createServer, databasePool);
      server = serverInfo.server;
      await runIntegrationTests(databasePool, serverInfo, fixtures, counts);
    } catch (error) {
      totalFailures += 1;
      console.error(`[FAIL] Harness setup or test execution — ${readFailure(error)}`);
    }
  } catch (error) {
    totalFailures += 1;
    const message = error instanceof TestDatabaseSafetyError
      ? error.message
      : readFailure(error);
    console.error(`[FAIL] Safety preflight — ${message}`);
  } finally {
    if (server) {
      try {
        await closeServer(server);
      } catch {
        totalFailures += 1;
        console.error("[FAIL] Could not close the loopback HTTP server.");
      }
    }

    if (preflightPassed && databasePool && fixtures) {
      try {
        await cleanupSyntheticRows(databasePool, fixtures);
        cleanupStatus = "verified; all six integration tables contain zero rows";
      } catch (error) {
        totalFailures += 1;
        cleanupStatus = "FAILED";
        console.error(`[FAIL] Cleanup — ${readFailure(error)}`);
      }
    }

    if (rawPool) {
      try {
        await rawPool.end();
      } catch {
        totalFailures += 1;
        cleanupStatus = "FAILED";
        console.error("[FAIL] Could not close the test database pool.");
      }
    }
  }

  const customerPassed = counts.customer.passed;
  const customerFailed = counts.customer.failed;
  const adminPassed = counts.admin.passed;
  const adminFailed = counts.admin.failed;
  const passed = customerPassed + adminPassed;
  const failed = customerFailed + adminFailed + totalFailures;
  console.log(`Customer tests: ${customerPassed} passed, ${customerFailed} failed.`);
  console.log(`Admin tests: ${adminPassed} passed, ${adminFailed} failed.`);
  console.log(`Total tests: ${passed} passed, ${failed} failed.`);
  console.log(`Cleanup: ${cleanupStatus}.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  const safeMessage = error instanceof TestDatabaseSafetyError
    ? error.message
    : readFailure(error);
  console.error(`[FAIL] Integration harness — ${safeMessage}`);
  process.exitCode = 1;
});
