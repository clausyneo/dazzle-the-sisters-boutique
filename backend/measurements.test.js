const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const { createServer } = require("./server");
const { GARMENT_CATEGORIES, MEASUREMENT_FIELDS } = require("./measurements");

const origin = "http://127.0.0.1:5500";
const customerToken = "C".repeat(43);
const otherCustomerToken = "D".repeat(43);
const adminToken = "A".repeat(43);

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createMeasurementPool(options = {}) {
  const state = {
    customers: new Map([
      [11, {
        customer_id: 11,
        name: "First Customer",
        email: "first@example.com",
        phone: "9999999999"
      }],
      [22, {
        customer_id: 22,
        name: "Second Customer",
        email: "second@example.com",
        phone: "8888888888"
      }]
    ]),
    customerSessions: new Map([
      [hashToken(customerToken), 11],
      [hashToken(otherCustomerToken), 22]
    ]),
    adminSessions: new Map([[hashToken(adminToken), { admin_id: 91, username: "studioadmin" }]]),
    profiles: new Map(),
    values: new Map(),
    queries: [],
    nextProfileId: 1,
    releasedConnections: 0,
    destroyedConnections: 0,
    customerLocks: new Map()
  };

  function toProfileRow(profile) {
    const customer = state.customers.get(profile.customer_id);
    return {
      ...profile,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.phone
    };
  }

  function matchesFilters(profile, search, category) {
    const customer = state.customers.get(profile.customer_id);
    const searchable = [
      customer.name,
      customer.email,
      customer.phone,
      profile.profile_name
    ].join(" ").toLowerCase();
    return (!search || searchable.includes(search)) &&
      (!category || profile.garment_category === category);
  }

  function releaseCustomerLocks(connection) {
    for (const customerId of connection.lockedCustomerIds) {
      const lock = state.customerLocks.get(customerId);
      if (!lock || lock.owner !== connection) continue;
      const next = lock.waiters.shift();
      if (next) {
        lock.owner = next.connection;
        next.connection.lockedCustomerIds.add(customerId);
        next.resolve();
      } else {
        state.customerLocks.delete(customerId);
      }
    }
    connection.lockedCustomerIds.clear();
  }

  async function acquireCustomerLock(customerId, connection) {
    const lock = state.customerLocks.get(customerId);
    if (!lock) {
      state.customerLocks.set(customerId, { owner: connection, waiters: [] });
      connection.lockedCustomerIds.add(customerId);
      return;
    }
    if (lock.owner === connection) return;
    await new Promise((resolve) => lock.waiters.push({ connection, resolve }));
  }

  async function execute(sql, parameters = [], connection = null) {
    state.queries.push({ sql, parameters });

    if (sql.includes("FROM customers WHERE customer_id = ? FOR UPDATE")) {
      const customerId = Number(parameters[0]);
      if (connection) await acquireCustomerLock(customerId, connection);
      const customer = state.customers.get(customerId);
      return [customer ? [{ customer_id: customer.customer_id }] : [], []];
    }

    if (sql.includes("FROM customer_sessions s")) {
      const customerId = state.customerSessions.get(parameters[0]);
      const customer = customerId && state.customers.get(customerId);
      return [customer ? [{
        customer_id: customer.customer_id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email
      }] : [], []];
    }

    if (sql.includes("FROM admin_sessions s")) {
      const admin = state.adminSessions.get(parameters[0]);
      return [admin ? [{ ...admin }] : [], []];
    }

    if (sql.includes("INSERT INTO customer_measurement_profiles")) {
      const profileId = state.nextProfileId++;
      const now = new Date();
      const profile = {
        profile_id: profileId,
        customer_id: Number(parameters[0]),
        garment_category: parameters[1],
        profile_name: parameters[2],
        unit_preference: parameters[3],
        fitting_preference: parameters[4],
        notes: parameters[5],
        last_updated_by_type: "CUSTOMER",
        last_updated_by_id: Number(parameters[6]),
        created_at: now,
        updated_at: now
      };
      state.profiles.set(profileId, profile);
      return [{ insertId: profileId, affectedRows: 1 }, []];
    }

    if (sql.includes("INSERT INTO customer_measurement_values")) {
      if (options.failValueInsert) {
        const error = new Error("test measurement value insert failure");
        error.code = "ER_TEST_VALUE_INSERT";
        throw error;
      }
      for (let index = 0; index < parameters.length; index += 3) {
        const [profileId, field, valueCm] = parameters.slice(index, index + 3);
        if (!state.values.has(Number(profileId))) state.values.set(Number(profileId), new Map());
        state.values.get(Number(profileId)).set(field, Number(valueCm));
      }
      return [{ affectedRows: parameters.length / 3 }, []];
    }

    if (sql.includes("FROM customer_measurement_profiles") &&
        /WHERE customer_id = \?\s+FOR UPDATE/.test(sql)) {
      const customerId = Number(parameters[0]);
      const profiles = [...state.profiles.values()]
        .filter((profile) => profile.customer_id === customerId)
        .map((profile) => ({ profile_id: profile.profile_id }));
      return [profiles, []];
    }

    if (sql.includes("SELECT COUNT(*) AS total") &&
        sql.includes("FROM customer_measurement_profiles p")) {
      const { search, category } = getAdminFilters(sql, parameters);
      const total = [...state.profiles.values()]
        .filter((profile) => matchesFilters(profile, search, category)).length;
      return [[{ total }], []];
    }

    if (sql.includes("FROM customer_measurement_profiles p") &&
        sql.includes("WHERE p.profile_id = ?")) {
      const profileId = Number(parameters[0]);
      const profile = state.profiles.get(profileId);
      const ownerClause = sql.includes("p.customer_id = ?");
      const row = profile && (!ownerClause || profile.customer_id === Number(parameters[1]))
        ? toProfileRow(profile)
        : null;
      return [row ? [{ ...row }] : [], []];
    }

    if (sql.includes("FROM customer_measurement_profiles p") &&
        sql.includes("WHERE p.customer_id = ?")) {
      const customerId = Number(parameters[0]);
      const profiles = [...state.profiles.values()]
        .filter((profile) => profile.customer_id === customerId)
        .sort((left, right) => right.profile_id - left.profile_id)
        .map(toProfileRow);
      return [profiles, []];
    }

    if (sql.includes("FROM customer_measurement_profiles p") &&
        sql.includes("ORDER BY p.updated_at DESC, p.profile_id DESC")) {
      const { search, category, filterCount } = getAdminFilters(sql, parameters);
      const limit = Number(/\bLIMIT (\d+) OFFSET \d+/.exec(sql)[1]);
      const offset = Number(/\bLIMIT \d+ OFFSET (\d+)/.exec(sql)[1]);
      const profiles = [...state.profiles.values()]
        .filter((profile) => matchesFilters(profile, search, category))
        .sort((left, right) => right.profile_id - left.profile_id)
        .slice(offset, offset + limit)
        .map(toProfileRow);
      return [profiles, []];
    }

    if (sql.includes("FROM customer_measurement_values")) {
      const profileIds = new Set(parameters.map(Number));
      const rows = [];
      for (const [profileId, values] of state.values) {
        if (!profileIds.has(profileId)) continue;
        for (const [measurementKey, valueCm] of values) {
          rows.push({
            profile_id: profileId,
            measurement_key: measurementKey,
            value_cm: valueCm
          });
        }
      }
      return [rows, []];
    }

    if (sql.includes("UPDATE customer_measurement_profiles")) {
      const profileId = Number(parameters[7]);
      const ownerId = Number(parameters[8]);
      const profile = state.profiles.get(profileId);
      if (!profile || profile.customer_id !== ownerId) return [{ affectedRows: 0 }, []];
      Object.assign(profile, {
        garment_category: parameters[0],
        profile_name: parameters[1],
        unit_preference: parameters[2],
        fitting_preference: parameters[3],
        notes: parameters[4],
        last_updated_by_type: parameters[5],
        last_updated_by_id: Number(parameters[6]),
        updated_at: new Date()
      });
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("DELETE FROM customer_measurement_values")) {
      state.values.delete(Number(parameters[0]));
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("DELETE FROM customer_measurement_profiles")) {
      const profileId = Number(parameters[0]);
      const customerId = Number(parameters[1]);
      const profile = state.profiles.get(profileId);
      if (!profile || profile.customer_id !== customerId) return [{ affectedRows: 0 }, []];
      state.profiles.delete(profileId);
      state.values.delete(profileId);
      return [{ affectedRows: 1 }, []];
    }

    const error = new Error(`Unexpected measurement test SQL: ${sql}`);
    error.code = "MOCK_UNEXPECTED_SQL";
    throw error;
  }

  return {
    state,
    execute,
    async getConnection() {
      const connection = {
        lockedCustomerIds: new Set(),
        execute: (sql, parameters = []) => execute(sql, parameters, connection),
        beginTransaction: async () => {},
        commit: async () => releaseCustomerLocks(connection),
        rollback: async () => {
          if (options.failRollback) {
            const error = new Error("test rollback failure");
            error.code = "ER_TEST_ROLLBACK_FAILURE";
            throw error;
          }
          releaseCustomerLocks(connection);
        },
        release: () => {
          state.releasedConnections += 1;
          releaseCustomerLocks(connection);
        },
        destroy: () => {
          state.destroyedConnections += 1;
          releaseCustomerLocks(connection);
        }
      };
      return connection;
    }
  };
}

function getAdminFilters(sql, parameters) {
  let index = 0;
  let search = "";
  let category = "";
  if (sql.includes("LOWER(CONCAT_WS")) {
    search = parameters[index++].replaceAll("%", "").toLowerCase();
  }
  if (sql.includes("p.garment_category = ?")) category = parameters[index++];
  return { search, category };
}

async function startServer(t, pool = createMeasurementPool()) {
  const server = createServer({
    pool,
    testDatabaseConnection: async () => true,
    frontendOrigin: origin
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const port = server.address().port;

  async function request(method, path, body, token, cookieName = "dazzle_session", headers = {}) {
    return new Promise((resolve, reject) => {
      const content = body === undefined ? undefined : JSON.stringify(body);
      const requestHeaders = { origin, ...headers };
      if (content !== undefined) {
        requestHeaders["content-type"] = "application/json";
        requestHeaders["content-length"] = Buffer.byteLength(content);
      }
      if (token) requestHeaders.cookie = `${cookieName}=${token}`;
      const outgoing = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: requestHeaders
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8")
        }));
      });
      outgoing.on("error", reject);
      if (content !== undefined) outgoing.write(content);
      outgoing.end();
    });
  }
  return { pool, request };
}

function parseBody(response) {
  return JSON.parse(response.body);
}

test("customer and admin measurement endpoints require their own authenticated sessions", async (t) => {
  const client = await startServer(t);
  for (const [method, path, body] of [
    ["GET", "/api/account/measurement-profiles"],
    ["POST", "/api/account/measurement-profiles", {}],
    ["GET", "/api/account/measurement-profiles/1"],
    ["PATCH", "/api/account/measurement-profiles/1", {}],
    ["DELETE", "/api/account/measurement-profiles/1"],
    ["GET", "/api/admin/measurement-profiles"],
    ["GET", "/api/admin/measurement-profiles/1"],
    ["PATCH", "/api/admin/measurement-profiles/1", {}]
  ]) {
    assert.equal((await client.request(method, path, body)).status, 401, `${method} ${path}`);
  }
  assert.equal(
    (await client.request(
      "GET", "/api/admin/measurement-profiles", undefined, customerToken
    )).status,
    401
  );
});

test("customer profile CRUD enforces ownership and converts preferred units", async (t) => {
  const client = await startServer(t);
  const created = await client.request("POST", "/api/account/measurement-profiles", {
    garmentCategory: "BLOUSE",
    profileName: "Wedding blouse",
    unitPreference: "in",
    fittingPreference: "SNUG",
    notes: "Keep the sleeve comfortable.",
    measurements: { bust: 36, waist: 30, blouse_length: 14 }
  }, customerToken);
  assert.equal(created.status, 201, created.body);
  const profile = parseBody(created).profile;
  const profileId = profile.profileId;
  assert.equal(profile.unitPreference, "in");
  assert.deepEqual(profile.measurements, { blouse_length: 14, bust: 36, waist: 30 });
  assert.equal(profile.lastUpdatedBy, "CUSTOMER");
  assert.equal(client.pool.state.values.get(profileId).get("bust"), 91.44);

  const secondProfile = await client.request("POST", "/api/account/measurement-profiles", {
    garmentCategory: "BLOUSE",
    profileName: "Everyday blouse",
    measurements: { bust: 34 }
  }, customerToken);
  assert.equal(secondProfile.status, 201);
  const secondProfileId = parseBody(secondProfile).profile.profileId;
  const otherCustomerProfile = await client.request("POST", "/api/account/measurement-profiles", {
    garmentCategory: "BLOUSE",
    profileName: "Second customer's blouse",
    measurements: { bust: 33 }
  }, otherCustomerToken);
  assert.equal(otherCustomerProfile.status, 201);

  const listing = await client.request(
    "GET", "/api/account/measurement-profiles", undefined, customerToken
  );
  assert.equal(listing.status, 200);
  assert.equal(parseBody(listing).profiles.length, 2);
  assert.ok(parseBody(listing).profiles.every((entry) => entry.profileId !==
    parseBody(otherCustomerProfile).profile.profileId));
  assert.ok(parseBody(listing).profiles.some((entry) => entry.profileId === profileId));

  const viewed = await client.request(
    "GET", `/api/account/measurement-profiles/${profileId}`, undefined, customerToken
  );
  assert.equal(viewed.status, 200);
  assert.equal(parseBody(viewed).profile.profileName, "Wedding blouse");

  for (const method of ["GET", "PATCH", "DELETE"]) {
    const body = method === "PATCH" ? { notes: "not mine" } : undefined;
    const response = await client.request(
      method,
      `/api/account/measurement-profiles/${profileId}`,
      body,
      otherCustomerToken
    );
    assert.equal(response.status, 404, `${method} must not reveal another customer's profile`);
  }

  const updated = await client.request(
    "PATCH",
    `/api/account/measurement-profiles/${profileId}`,
    { unitPreference: "cm", fittingPreference: "RELAXED" },
    customerToken
  );
  assert.equal(updated.status, 200);
  assert.equal(parseBody(updated).profile.measurements.bust, 91.44);
  assert.equal(parseBody(updated).profile.lastUpdatedBy, "CUSTOMER");

  const deleted = await client.request(
    "DELETE", `/api/account/measurement-profiles/${profileId}`, undefined, customerToken
  );
  assert.equal(deleted.status, 200);
  assert.equal(client.pool.state.profiles.has(profileId), false);
  assert.equal(client.pool.state.values.has(profileId), false);
  assert.equal(client.pool.state.profiles.has(secondProfileId), true);
});

test("customer profile limit is enforced for concurrent creates", async (t) => {
  const pool = createMeasurementPool();
  for (let profileId = 1; profileId <= 19; profileId += 1) {
    pool.state.profiles.set(profileId, {
      profile_id: profileId,
      customer_id: 11,
      garment_category: "BLOUSE",
      profile_name: `Existing ${profileId}`,
      unit_preference: "cm",
      fitting_preference: null,
      notes: null,
      last_updated_by_type: "CUSTOMER",
      last_updated_by_id: 11,
      created_at: new Date(),
      updated_at: new Date()
    });
  }
  pool.state.nextProfileId = 20;
  const client = await startServer(t, pool);
  const body = {
    garmentCategory: "BLOUSE",
    profileName: "Concurrent profile",
    measurements: { bust: 90 }
  };
  const responses = await Promise.all([
    client.request("POST", "/api/account/measurement-profiles", body, customerToken),
    client.request("POST", "/api/account/measurement-profiles", body, customerToken)
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const rejected = responses.find((response) => response.status === 409);
  assert.equal(parseBody(rejected).message, "You can save up to 20 measurement profiles.");
  assert.equal(
    [...pool.state.profiles.values()].filter((profile) => profile.customer_id === 11).length,
    20
  );
  const customerLocks = pool.state.queries.filter((query) =>
    query.sql.includes("FROM customers WHERE customer_id = ? FOR UPDATE")
  );
  assert.equal(customerLocks.length, 2);
  const profileLocks = pool.state.queries.filter((query) =>
    query.sql.includes("FROM customer_measurement_profiles") &&
    /WHERE customer_id = \?\s+FOR UPDATE/.test(query.sql)
  );
  assert.equal(profileLocks.length, 2);
});

test("measurement profile transactions release or destroy each connection exactly once", async (t) => {
  const body = {
    garmentCategory: "BLOUSE",
    profileName: "Connection cleanup",
    measurements: { bust: 90 }
  };

  const successfulPool = createMeasurementPool();
  const successfulClient = await startServer(t, successfulPool);
  const success = await successfulClient.request(
    "POST", "/api/account/measurement-profiles", body, customerToken
  );
  assert.equal(success.status, 201);
  assert.equal(successfulPool.state.releasedConnections, 1);
  assert.equal(successfulPool.state.destroyedConnections, 0);

  const rollbackPool = createMeasurementPool({ failValueInsert: true });
  const rollbackClient = await startServer(t, rollbackPool);
  const rolledBack = await rollbackClient.request(
    "POST", "/api/account/measurement-profiles", body, customerToken
  );
  assert.equal(rolledBack.status, 500);
  assert.equal(rollbackPool.state.releasedConnections, 1);
  assert.equal(rollbackPool.state.destroyedConnections, 0);

  const failedRollbackPool = createMeasurementPool({
    failValueInsert: true,
    failRollback: true
  });
  const failedRollbackClient = await startServer(t, failedRollbackPool);
  const failedRollback = await failedRollbackClient.request(
    "POST", "/api/account/measurement-profiles", body, customerToken
  );
  assert.equal(failedRollback.status, 500);
  assert.equal(failedRollbackPool.state.releasedConnections, 0);
  assert.equal(failedRollbackPool.state.destroyedConnections, 1);
});

test("all six garment categories accept their configured measurement fields", async (t) => {
  const client = await startServer(t);
  for (const garmentCategory of GARMENT_CATEGORIES) {
    const response = await client.request("POST", "/api/account/measurement-profiles", {
      garmentCategory,
      profileName: `${garmentCategory} profile`,
      measurements: { [MEASUREMENT_FIELDS[garmentCategory][0]]: 50 }
    }, customerToken);
    assert.equal(response.status, 201, `${garmentCategory}: ${response.body}`);
  }
  assert.equal(client.pool.state.profiles.size, GARMENT_CATEGORIES.length);
});

test("profile input validates categories, field names, values, units and ownership fields", async (t) => {
  const client = await startServer(t);
  const valid = {
    garmentCategory: "BLOUSE",
    profileName: "Test profile",
    measurements: { bust: 36 }
  };
  const invalidBodies = [
    { ...valid, garmentCategory: "LEGACY_USERS" },
    { ...valid, measurements: { trouser_length: 36 } },
    { ...valid, measurements: { bust: -1 } },
    { ...valid, measurements: { bust: 36.123 } },
    { ...valid, measurements: { bust: "36" } },
    { ...valid, unitPreference: "feet" },
    { ...valid, customerId: 22 },
    { ...valid, profileName: " " }
  ];
  for (const body of invalidBodies) {
    const response = await client.request(
      "POST", "/api/account/measurement-profiles", body, customerToken
    );
    assert.equal(response.status, 400, response.body);
  }
  assert.equal(client.pool.state.profiles.size, 0);
});

test("admin profile routes search, view and edit only with admin authentication", async (t) => {
  const client = await startServer(t);
  const created = await client.request("POST", "/api/account/measurement-profiles", {
    garmentCategory: "KURTI",
    profileName: "Office kurti",
    measurements: { bust: 92, kurti_length: 110 }
  }, customerToken);
  const profileId = parseBody(created).profile.profileId;

  const listing = await client.request(
    "GET",
    "/api/admin/measurement-profiles?search=first%40example.com&garmentCategory=KURTI&page=1&pageSize=10",
    undefined,
    adminToken,
    "dazzle_admin_session"
  );
  assert.equal(listing.status, 200, listing.body);
  assert.equal(parseBody(listing).profiles.length, 1);
  assert.equal(parseBody(listing).profiles[0].customer.email, "first@example.com");
  assert.deepEqual(parseBody(listing).pagination, {
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1
  });
  const searchQuery = client.pool.state.queries.find((query) =>
    query.sql.includes("LOWER(CONCAT_WS")
  );
  assert.match(searchQuery.sql, /LIKE \?/);
  assert.deepEqual(searchQuery.parameters, ["%first@example.com%", "KURTI"]);

  const viewed = await client.request(
    "GET",
    `/api/admin/measurement-profiles/${profileId}`,
    undefined,
    adminToken,
    "dazzle_admin_session"
  );
  assert.equal(viewed.status, 200);
  assert.equal(parseBody(viewed).profile.measurements.bust, 92);

  const updated = await client.request(
    "PATCH",
    `/api/admin/measurement-profiles/${profileId}`,
    { profileName: "Admin-reviewed kurti", notes: "Fit confirmed." },
    adminToken,
    "dazzle_admin_session"
  );
  assert.equal(updated.status, 200);
  assert.equal(parseBody(updated).profile.profileName, "Admin-reviewed kurti");
  assert.equal(parseBody(updated).profile.lastUpdatedBy, "ADMIN");
  assert.equal(client.pool.state.profiles.get(profileId).last_updated_by_id, 91);

  assert.equal(
    (await client.request(
      "GET",
      "/api/admin/measurement-profiles?garmentCategory=UNKNOWN",
      undefined,
      adminToken,
      "dazzle_admin_session"
    )).status,
    400
  );
  assert.equal(
    (await client.request(
      "GET",
      "/api/admin/measurement-profiles?page=0",
      undefined,
      adminToken,
      "dazzle_admin_session"
    )).status,
    400
  );
});

test("DELETE preflight is limited to customer measurement profile routes", async (t) => {
  const client = await startServer(t);
  const allowed = await client.request(
    "OPTIONS",
    "/api/account/measurement-profiles/12",
    undefined,
    undefined,
    "dazzle_session",
    {
      "access-control-request-method": "DELETE",
      "access-control-request-headers": "content-type"
    }
  );
  assert.equal(allowed.status, 204);
  assert.match(allowed.headers["access-control-allow-methods"], /\bDELETE\b/);

  const unrelated = await client.request(
    "OPTIONS",
    "/api/account/me",
    undefined,
    undefined,
    "dazzle_session",
    { "access-control-request-method": "DELETE" }
  );
  assert.equal(unrelated.status, 403);
});
