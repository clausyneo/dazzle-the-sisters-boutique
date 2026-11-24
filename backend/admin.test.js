const assert = require("node:assert/strict");
const { createHash, scryptSync } = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const {
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminAccount,
  resetAdminPassword
} = require("./admin");
const { createServer } = require("./server");

const origin = "http://127.0.0.1:5500";
const password = "admin-pass-2026";

test("admin session cookies support cross-origin HTTPS production", () => {
  assert.equal(
    adminSessionCookie("token", true),
    "dazzle_admin_session=token; HttpOnly; SameSite=None; Path=/; Max-Age=28800; Secure"
  );
  assert.equal(
    clearAdminSessionCookie(true),
    "dazzle_admin_session=; HttpOnly; SameSite=None; Path=/; Max-Age=0; Secure"
  );
});

test("admin session cookies retain local development settings and expiry", () => {
  assert.equal(
    adminSessionCookie("token", false),
    "dazzle_admin_session=token; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800"
  );
  assert.equal(
    clearAdminSessionCookie(false),
    "dazzle_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
  );
});

test("admin and configured customer frontends receive credentialed CORS access", async (t) => {
  const customerOrigin = "https://shop.example.com";
  const adminOrigin = "https://dazzle-admin.onrender.com";
  const client = await startServer(t, undefined, {
    frontendOrigin: customerOrigin,
    adminFrontendOrigin: adminOrigin
  });
  await createAdmin(client.pool);
  const adminPreflight = await client.request(
    "OPTIONS",
    "/api/admin/login",
    undefined,
    undefined,
    adminOrigin,
    {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  );
  const adminLogin = await client.request(
    "POST",
    "/api/admin/login",
    { username: "boutiqueadmin", password },
    undefined,
    adminOrigin
  );
  const adminSession = await client.request(
    "GET",
    "/api/admin/me",
    undefined,
    cookieFrom(adminLogin),
    adminOrigin
  );
  const customerResponse = await client.request("GET", "/api/status", undefined, undefined, customerOrigin);
  const unrelatedResponse = await client.request(
    "GET", "/api/status", undefined, undefined, "https://unapproved.example"
  );

  assert.equal(adminPreflight.status, 204);
  assert.equal(adminPreflight.headers["access-control-allow-origin"], adminOrigin);
  assert.equal(adminPreflight.headers["access-control-allow-credentials"], "true");
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.headers["access-control-allow-origin"], adminOrigin);
  assert.equal(adminLogin.headers["access-control-allow-credentials"], "true");
  assert.equal(adminSession.status, 200);
  assert.equal(adminSession.headers["access-control-allow-origin"], adminOrigin);
  assert.equal(adminSession.headers["access-control-allow-credentials"], "true");
  assert.equal(customerResponse.headers["access-control-allow-origin"], customerOrigin);
  assert.equal(customerResponse.headers["access-control-allow-credentials"], "true");
  assert.equal(unrelatedResponse.headers["access-control-allow-origin"], undefined);
});

function createAdminPool() {
  const state = {
    admins: [],
    sessions: new Map(),
    queries: [],
    failOrders: false,
    failPaymentRollback: false,
    destroyedConnections: 0,
    releasedConnections: 0,
    statusCommitCount: 0,
    customers: [{ customer_id: 10, email: "account@example.com" }],
    orders: [
      {
        order_id: 1, customer_id: null, order_number: "DB-GUEST-001",
        customer_name: "Guest Customer", mobile_number: "9999999999", email: null,
        delivery_address: "Guest address", city: "Delhi", pin_code: "110001",
        created_at: "2026-03-10T10:00:00.000Z", total_amount: "1000.00",
        payment_method: "COD", payment_status: "Pending", order_status: "Order Placed"
      },
      {
        order_id: 2, customer_id: 10, order_number: "DB-ACCOUNT-002",
        customer_name: "Account Customer", mobile_number: "8888888888", email: "customer@example.com",
        delivery_address: "Account address", city: "Noida", pin_code: "201301",
        created_at: "2026-03-11T10:00:00.000Z", total_amount: "2500.00",
        payment_method: "COD", payment_status: "Paid", order_status: "Delivered"
      },
      {
        order_id: 3, customer_id: null, order_number: "DB-CANCEL-003",
        customer_name: "Cancelled Guest", mobile_number: "7777777777", email: null,
        delivery_address: "Another address", city: "Delhi", pin_code: "110002",
        created_at: "2026-03-12T10:00:00.000Z", total_amount: "500.00",
        payment_method: "COD", payment_status: "Pending", order_status: "Cancelled"
      }
    ],
    items: [{
      order_id: 1, product_name_snapshot: "Meera Floral Kurti",
      selected_size: "M", quantity: 2, product_price_snapshot: "500.00",
      item_subtotal: "1000.00"
    }]
  };
  let nextAdminId = 1;

  function filterOrders(sql, parameters) {
    let parameterIndex = 0;
    let rows = [...state.orders];
    if (sql.includes("order_number LIKE ?")) {
      const search = parameters[parameterIndex++].replaceAll("%", "");
      rows = rows.filter((order) => order.order_number.includes(search));
    }
    if (sql.includes("order_status = ?")) {
      const status = parameters[parameterIndex++];
      rows = rows.filter((order) => order.order_status === status);
    }
    if (sql.includes("created_at >= ?")) {
      const start = parameters[parameterIndex++];
      rows = rows.filter((order) => order.created_at.slice(0, 10) >= start);
    }
    if (sql.includes("DATE_ADD(?, INTERVAL 1 DAY)")) {
      const end = parameters[parameterIndex++];
      rows = rows.filter((order) => order.created_at.slice(0, 10) <= end);
    }
    return rows;
  }

  async function execute(sql, parameters = []) {
    state.queries.push({ sql, parameters });
    if (sql === "SELECT admin_id FROM admin_users LIMIT 1") {
      return [state.admins.slice(0, 1).map(({ admin_id }) => ({ admin_id })), []];
    }
    if (sql.includes("INSERT INTO admin_users")) {
      if (state.admins.some((admin) => admin.username === parameters[0])) {
        const error = new Error("duplicate admin");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      const admin = {
        admin_id: nextAdminId++,
        username: parameters[0],
        password_salt: parameters[1],
        password_hash: parameters[2],
        is_active: 1
      };
      state.admins.push(admin);
      return [{ insertId: admin.admin_id, affectedRows: 1 }, []];
    }
    if (sql.includes("UPDATE admin_users") && sql.includes("SET password_salt")) {
      const admin = state.admins.find((entry) => entry.username === parameters[2]);
      if (!admin) return [{ affectedRows: 0 }, []];
      admin.password_salt = parameters[0];
      admin.password_hash = parameters[1];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("FROM admin_users") && sql.includes("WHERE username = ?")) {
      const admin = state.admins.find((entry) =>
        entry.username === parameters[0] && entry.is_active === 1
      );
      return [admin ? [{ ...admin }] : [], []];
    }
    if (sql.includes("INSERT INTO admin_sessions")) {
      state.sessions.set(parameters[1], {
        admin_id: parameters[0],
        expires_at: parameters[2]
      });
      return [{ insertId: state.sessions.size, affectedRows: 1 }, []];
    }
    if (sql.includes("FROM admin_sessions s")) {
      const session = state.sessions.get(parameters[0]);
      const expiresAt = session
        ? new Date(`${session.expires_at.replace(" ", "T")}Z`)
        : new Date(0);
      const admin = session && expiresAt > new Date()
        ? state.admins.find((entry) =>
          entry.admin_id === session.admin_id && entry.is_active === 1
        )
        : null;
      return [admin ? [{ admin_id: admin.admin_id, username: admin.username }] : [], []];
    }
    if (sql.includes("DELETE FROM admin_sessions")) {
      return [{ affectedRows: state.sessions.delete(parameters[0]) ? 1 : 0 }, []];
    }
    if (state.failOrders && sql.includes("FROM orders")) {
      const error = new Error("private database detail");
      error.code = "ER_TEST_FAILURE";
      throw error;
    }
    if (sql.includes("FROM orders") && sql.includes("FOR UPDATE")) {
      const order = state.orders.find((entry) => String(entry.order_id) === String(parameters[0]));
      const customer = order && state.customers.find((entry) =>
        entry.customer_id === order.customer_id
      );
      return [order ? [{
        ...order,
        account_email: customer ? customer.email : null
      }] : [], []];
    }
    if (sql.startsWith("UPDATE orders SET order_status")) {
      const order = state.orders.find((entry) => String(entry.order_id) === String(parameters[1]));
      if (!order) return [{ affectedRows: 0 }, []];
      order.order_status = parameters[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("UPDATE orders") && sql.includes("SET payment_status")) {
      const order = state.orders.find((entry) => String(entry.order_id) === String(parameters[1]));
      if (!order) return [{ affectedRows: 0 }, []];
      if (order.payment_status !== parameters[2]) return [{ affectedRows: 0 }, []];
      order.payment_status = parameters[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("FROM orders") && sql.includes("WHERE order_id = ?")) {
      const order = state.orders.find((entry) => String(entry.order_id) === String(parameters[0]));
      return [order ? [{ ...order }] : [], []];
    }
    if (sql.includes("FROM order_items")) {
      const items = state.items.filter((item) => String(item.order_id) === String(parameters[0]));
      return [items.map((item) => ({ ...item })), []];
    }
    if (sql.includes("COUNT(*) AS total_orders")) {
      const notCancelled = state.orders.filter((order) => order.order_status !== "Cancelled");
      return [[{
        total_orders: state.orders.length,
        pending_orders: state.orders.filter((order) =>
          !["Delivered", "Cancelled"].includes(order.order_status)
        ).length,
        completed_orders: state.orders.filter((order) => order.order_status === "Delivered").length,
        order_value: notCancelled.reduce((sum, order) => sum + Number(order.total_amount), 0)
      }], []];
    }
    if (sql.includes("COUNT(*) AS total") && sql.includes("FROM orders")) {
      return [[{ total: filterOrders(sql, parameters).length }], []];
    }
    const pagination = sql.match(/\bLIMIT (\d+) OFFSET (\d+)\b/);
    if (sql.includes("FROM orders") && pagination) {
      const rows = filterOrders(sql, parameters).sort((left, right) =>
        right.created_at.localeCompare(left.created_at)
      );
      const pageSize = Number(pagination[1]);
      const offset = Number(pagination[2]);
      return [rows.slice(offset, offset + pageSize).map((order) => ({ ...order })), []];
    }
    throw new Error(`Unexpected admin SQL: ${sql}`);
  }

  let connectionBusy = false;
  const pendingConnections = [];

  return {
    state,
    execute,
    async getConnection() {
      const connection = {
        async beginTransaction() {
          if (connectionBusy) {
            await new Promise((resolve) => pendingConnections.push(resolve));
          }
          connectionBusy = true;
        },
        async execute(sql, parameters = []) {
          return execute(sql, parameters);
        },
        async commit() {
          state.statusCommitCount += 1;
          connectionBusy = false;
          const resolve = pendingConnections.shift();
          if (resolve) resolve();
        },
        async rollback() {
          if (state.failPaymentRollback) {
            const error = new Error("private rollback detail");
            error.code = "ER_TEST_ROLLBACK_FAILURE";
            throw error;
          }
          connectionBusy = false;
          const resolve = pendingConnections.shift();
          if (resolve) resolve();
        },
        release() {
          state.releasedConnections += 1;
          connectionBusy = false;
          const resolve = pendingConnections.shift();
          if (resolve) resolve();
        },
        destroy() {
          state.destroyedConnections += 1;
          connectionBusy = false;
          const resolve = pendingConnections.shift();
          if (resolve) resolve();
        }
      };
      return connection;
    }
  };
}

async function startServer(t, pool = createAdminPool(), options = {}) {
  const server = createServer({
    pool,
    testDatabaseConnection: async () => true,
    sendOrderStatusUpdateEmail: async () => {},
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const port = server.address().port;

  async function request(method, path, body, cookie, requestOrigin = origin, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const content = body === undefined ? undefined : JSON.stringify(body);
      const headers = {};
      if (requestOrigin) headers.origin = requestOrigin;
      Object.assign(headers, extraHeaders);
      if (content !== undefined) {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(content);
      }
      if (cookie) headers.cookie = cookie;
      const outgoing = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers
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

function cookieFrom(response) {
  const cookie = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"];
  return cookie.split(";")[0];
}

async function createAdmin(pool) {
  await createAdminAccount(pool, "BoutiqueAdmin", password);
}

async function login(client) {
  return client.request("POST", "/api/admin/login", {
    username: "boutiqueadmin",
    password
  });
}

test("admin login uses a separate scrypt account and HttpOnly admin session", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const stored = client.pool.state.admins[0];
  assert.equal(stored.password_salt.length, 32);
  assert.equal(stored.password_hash.length, 128);
  assert.notEqual(stored.password_hash, password);
  await assert.rejects(
    createAdminAccount(client.pool, "SecondAdmin", password),
    /First-admin setup is already complete/
  );

  const response = await login(client);
  assert.equal(response.status, 200, response.body);
  assert.match(String(response.headers["set-cookie"]), /dazzle_admin_session=/);
  assert.match(String(response.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(response.headers["set-cookie"]), /SameSite=Strict/);
  assert.doesNotMatch(response.body, /password_hash|password_salt|token/);
  assert.deepEqual(parseBody(response).admin, { adminId: 1, username: "boutiqueadmin" });

  const incorrect = await client.request("POST", "/api/admin/login", {
    username: "boutiqueadmin",
    password: "incorrect password"
  });
  assert.equal(incorrect.status, 401);
});

test("admin login accepts existing passwords longer than 16 characters", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);

  const legacyPassword = "legacy-admin-password";
  assert.ok(legacyPassword.length > 16);
  const salt = Buffer.alloc(16, 0x42);
  const admin = client.pool.state.admins[0];
  admin.password_salt = salt.toString("hex");
  admin.password_hash = scryptSync(legacyPassword, salt, 64).toString("hex");

  const response = await client.request("POST", "/api/admin/login", {
    username: "boutiqueadmin",
    password: legacyPassword
  });
  assert.equal(response.status, 200, response.body);
});

test("admin password reset changes only that account's salted scrypt credentials", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const admin = client.pool.state.admins[0];
  const oldSalt = admin.password_salt;
  const oldHash = admin.password_hash;
  const sessionBefore = client.pool.state.sessions.size;
  const ordersBefore = JSON.stringify(client.pool.state.orders);
  const itemsBefore = JSON.stringify(client.pool.state.items);
  const newPassword = "reset-pass-2026";

  const result = await resetAdminPassword(client.pool, " BOUTIQUEADMIN ", newPassword);
  assert.deepEqual(result, { username: "boutiqueadmin" });
  assert.notEqual(admin.password_salt, oldSalt);
  assert.notEqual(admin.password_hash, oldHash);
  assert.equal(admin.password_salt.length, 32);
  assert.equal(admin.password_hash.length, 128);
  assert.notEqual(admin.password_hash, newPassword);
  assert.equal(client.pool.state.sessions.size, sessionBefore);
  assert.equal(JSON.stringify(client.pool.state.orders), ordersBefore);
  assert.equal(JSON.stringify(client.pool.state.items), itemsBefore);
  assert.deepEqual(
    client.pool.state.queries.at(-1),
    {
      sql: `UPDATE admin_users
     SET password_salt = ?, password_hash = ?
     WHERE username = ?`,
      parameters: [admin.password_salt, admin.password_hash, "boutiqueadmin"]
    }
  );

  const successfulLogin = await client.request("POST", "/api/admin/login", {
    username: "boutiqueadmin",
    password: newPassword
  });
  assert.equal(successfulLogin.status, 200);
  assert.doesNotMatch(successfulLogin.body, /reset-pass-2026/);
});

test("admin password reset rejects missing admins and invalid password lengths", async () => {
  const pool = createAdminPool();
  await assert.rejects(
    resetAdminPassword(pool, "unknownadmin", "reset-pass-2026"),
    /No admin account was found/
  );
  await assert.rejects(
    resetAdminPassword(pool, "validadmin", "short"),
    /Password must be between 7 and 16 characters/
  );
  assert.equal(pool.state.admins.length, 0);
});

test("admin create and reset accept 7/16 character passwords and reject 6/17", async () => {
  for (const length of [7, 16]) {
    const pool = createAdminPool();
    await createAdminAccount(pool, "validadmin", "p".repeat(length));
    await resetAdminPassword(pool, "validadmin", "q".repeat(length));
  }

  for (const length of [6, 17]) {
    const pool = createAdminPool();
    await assert.rejects(
      createAdminAccount(pool, "validadmin", "p".repeat(length)),
      /Password must be between 7 and 16 characters/
    );
    await createAdminAccount(pool, "validadmin", "valid-pass");
    await assert.rejects(
      resetAdminPassword(pool, "validadmin", "q".repeat(length)),
      /Password must be between 7 and 16 characters/
    );
  }
});

test("admin routes reject missing, expired and customer-only sessions; logout revokes the admin session", async (t) => {
  const client = await startServer(t);
  const unauthenticated = await client.request("GET", "/api/admin/dashboard");
  assert.equal(unauthenticated.status, 401);

  const customerSession = await client.request(
    "GET", "/api/admin/dashboard", undefined, "dazzle_session=customer-session-token-value"
  );
  assert.equal(customerSession.status, 401);

  await createAdmin(client.pool);
  const loggedIn = await login(client);
  const cookie = cookieFrom(loggedIn);
  const current = await client.request("GET", "/api/admin/me", undefined, cookie);
  assert.equal(current.status, 200);

  const token = cookie.split("=")[1];
  const tokenHash = createHash("sha256").update(token).digest("hex");
  client.pool.state.sessions.get(tokenHash).expires_at = "2000-01-01 00:00:00";
  assert.equal((await client.request("GET", "/api/admin/me", undefined, cookie)).status, 401);

  client.pool.state.sessions.get(tokenHash).expires_at = "2099-01-01 00:00:00";
  const logout = await client.request("POST", "/api/admin/logout", undefined, cookie);
  assert.equal(logout.status, 200);
  assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
  assert.equal((await client.request("GET", "/api/admin/me", undefined, cookie)).status, 401);
});

test("admin dashboard summary counts orders and excludes cancelled value", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));
  const response = await client.request("GET", "/api/admin/dashboard", undefined, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(parseBody(response).summary, {
    totalOrders: 3,
    pendingOrders: 1,
    completedOrders: 1,
    orderValue: 3500
  });
});

test("admin order listing defaults, paginates, filters and returns empty results safely", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));

  const defaultListing = await client.request("GET", "/api/admin/orders", undefined, cookie);
  assert.equal(defaultListing.status, 200);
  assert.deepEqual(parseBody(defaultListing).orders.map((order) => order.orderNumber), [
    "DB-CANCEL-003", "DB-ACCOUNT-002", "DB-GUEST-001"
  ]);
  assert.deepEqual(parseBody(defaultListing).pagination, {
    page: 1,
    pageSize: 20,
    total: 3,
    totalPages: 1
  });
  const defaultQuery = client.pool.state.queries.find((entry) =>
    entry.sql.includes("ORDER BY created_at DESC")
  );
  assert.match(defaultQuery.sql, /\bLIMIT 20 OFFSET 0\b/);
  assert.deepEqual(defaultQuery.parameters, []);

  const firstPage = await client.request(
    "GET", "/api/admin/orders?page=1&pageSize=2", undefined, cookie
  );
  assert.equal(firstPage.status, 200);
  assert.deepEqual(parseBody(firstPage).orders.map((order) => order.orderNumber), [
    "DB-CANCEL-003", "DB-ACCOUNT-002"
  ]);
  assert.equal(parseBody(firstPage).pagination.total, 3);

  const secondPage = await client.request(
    "GET", "/api/admin/orders?page=2&pageSize=2", undefined, cookie
  );
  assert.equal(secondPage.status, 200);
  assert.deepEqual(parseBody(secondPage).orders.map((order) => order.orderNumber), ["DB-GUEST-001"]);
  assert.deepEqual(parseBody(secondPage).pagination, {
    page: 2,
    pageSize: 2,
    total: 3,
    totalPages: 2
  });
  const paginatedQuery = client.pool.state.queries.filter((entry) =>
    entry.sql.includes("ORDER BY created_at DESC")
  ).at(-1);
  assert.match(paginatedQuery.sql, /\bLIMIT 2 OFFSET 2\b/);
  assert.deepEqual(paginatedQuery.parameters, []);

  const guest = await client.request(
    "GET", "/api/admin/orders?search=GUEST-001&status=Order%20Placed&from=2026-03-10&to=2026-03-10",
    undefined, cookie
  );
  assert.equal(guest.status, 200);
  assert.deepEqual(parseBody(guest).orders.map((order) => order.orderNumber), ["DB-GUEST-001"]);
  const listingQuery = client.pool.state.queries.filter((entry) =>
    entry.sql.includes("ORDER BY created_at DESC")
  ).at(-1);
  assert.match(listingQuery.sql, /order_number LIKE \?/);
  assert.match(listingQuery.sql, /order_status = \?/);
  assert.match(listingQuery.sql, /created_at >= \?/);
  assert.match(listingQuery.sql, /created_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.match(listingQuery.sql, /\bLIMIT 20 OFFSET 0\b/);
  assert.deepEqual(listingQuery.parameters, [
    "%GUEST-001%",
    "Order Placed",
    "2026-03-10",
    "2026-03-10"
  ]);

  const empty = await client.request(
    "GET", "/api/admin/orders?search=NOT-FOUND", undefined, cookie
  );
  assert.equal(empty.status, 200);
  assert.deepEqual(parseBody(empty).orders, []);
  assert.deepEqual(parseBody(empty).pagination, {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0
  });

  const invalidPage = await client.request(
    "GET", "/api/admin/orders?page=0", undefined, cookie
  );
  assert.equal(invalidPage.status, 400);
  const invalidPageSize = await client.request(
    "GET", "/api/admin/orders?pageSize=51", undefined, cookie
  );
  assert.equal(invalidPageSize.status, 400);
  const invalidRange = await client.request(
    "GET", "/api/admin/orders?from=2026-03-12&to=2026-03-10", undefined, cookie
  );
  assert.equal(invalidRange.status, 400);
});

test("admin order details return only delivery and item snapshot fields", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));
  const response = await client.request("GET", "/api/admin/orders/1", undefined, cookie);
  assert.equal(response.status, 200);
  const { order } = parseBody(response);
  assert.equal(order.customer.name, "Guest Customer");
  assert.equal(order.customer.phone, "9999999999");
  assert.equal(order.items[0].productName, "Meera Floral Kurti");
  assert.equal(order.items[0].size, "M");
  assert.equal(order.items[0].unitPrice, 500);
  assert.equal(order.items[0].subtotal, 1000);
  assert.doesNotMatch(response.body, /password|token_hash|session_id|customer_id/);
  assert.equal((await client.request("GET", "/api/admin/orders/0", undefined, cookie)).status, 400);
});

test("admin status updates validate forward transitions and never alter payment or stock", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));

  const confirmed = await client.request("PATCH", "/api/admin/orders/1/status", {
    orderStatus: "Confirmed"
  }, cookie);
  assert.equal(confirmed.status, 200);
  assert.equal(client.pool.state.orders[0].order_status, "Confirmed");
  assert.equal(client.pool.state.orders[0].payment_status, "Pending");
  assert.equal(client.pool.state.queries.some((entry) =>
    entry.sql.includes("storefront_product_sizes")
  ), false);
  assert.equal(client.pool.state.queries.some((entry) =>
    entry.sql.includes("UPDATE orders SET order_status")
  ), true);

  const invalidValue = await client.request("PATCH", "/api/admin/orders/1/status", {
    orderStatus: "Dispatched"
  }, cookie);
  assert.equal(invalidValue.status, 400);
  const skipped = await client.request("PATCH", "/api/admin/orders/1/status", {
    orderStatus: "Shipped"
  }, cookie);
  assert.equal(skipped.status, 409);

  const cancelled = await client.request("PATCH", "/api/admin/orders/1/status", {
    orderStatus: "Cancelled"
  }, cookie);
  assert.equal(cancelled.status, 200);
  const terminal = await client.request("PATCH", "/api/admin/orders/1/status", {
    orderStatus: "Confirmed"
  }, cookie);
  assert.equal(terminal.status, 409);
});

test("admin COD payment recording marks a pending order as paid without changing order status", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));

  const response = await client.request("PATCH", "/api/admin/orders/1/payment-status", undefined, cookie);
  assert.equal(response.status, 200);
  const body = parseBody(response);
  assert.equal(body.order.paymentStatus, "Paid");
  assert.equal(body.order.orderStatus, "Order Placed");
  assert.equal(client.pool.state.orders[0].payment_status, "Paid");
  assert.equal(client.pool.state.orders[0].order_status, "Order Placed");
  assert.equal(client.pool.state.orders[0].total_amount, "1000.00");
  assert.equal(client.pool.state.queries.some((entry) =>
    entry.sql.includes("SET payment_status")
  ), true);
  assert.equal(client.pool.state.queries.some((entry) =>
    entry.sql.includes("UPDATE orders SET order_status")
  ), false);
});

test("admin COD payment recording rejects invalid, duplicate and non-COD orders", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));

  const invalidId = await client.request("PATCH", "/api/admin/orders/not-a-number/payment-status", undefined, cookie);
  assert.equal(invalidId.status, 400);

  const missing = await client.request("PATCH", "/api/admin/orders/999/payment-status", undefined, cookie);
  assert.equal(missing.status, 404);

  client.pool.state.orders[0].payment_method = "UPI";
  const nonCod = await client.request("PATCH", "/api/admin/orders/1/payment-status", undefined, cookie);
  assert.equal(nonCod.status, 409);

  client.pool.state.orders[0].payment_method = "COD";
  client.pool.state.orders[0].payment_status = "Paid";
  const duplicate = await client.request("PATCH", "/api/admin/orders/1/payment-status", undefined, cookie);
  assert.equal(duplicate.status, 409);
});

test("admin COD payment recording rejects cancelled orders without changing their state", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));
  const order = client.pool.state.orders[2];

  const response = await client.request(
    "PATCH",
    "/api/admin/orders/3/payment-status",
    undefined,
    cookie
  );

  assert.equal(response.status, 409);
  assert.equal(parseBody(response).message, "Cancelled orders cannot be marked as paid.");
  assert.equal(order.payment_status, "Pending");
  assert.equal(order.order_status, "Cancelled");
});

test("admin COD payment recording requires admin auth and a valid origin", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);

  const unauthorized = await client.request("PATCH", "/api/admin/orders/1/payment-status", undefined, undefined);
  assert.equal(unauthorized.status, 401);

  const cookie = cookieFrom(await login(client));
  const blocked = await client.request(
    "PATCH",
    "/api/admin/orders/1/payment-status",
    undefined,
    cookie,
    "http://attacker.example"
  );
  assert.equal(blocked.status, 403);
});

test("admin COD payment recording rolls back on database failure without changing payment state", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));

  client.pool.state.failOrders = true;
  const response = await client.request("PATCH", "/api/admin/orders/1/payment-status", undefined, cookie);
  assert.equal(response.status, 500);
  assert.equal(client.pool.state.orders[0].payment_status, "Pending");
  assert.doesNotMatch(response.body, /private database detail|ER_TEST_FAILURE/);
});

test("admin COD payment recording destroys the connection when rollback fails", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));
  const initialDestroyedConnections = client.pool.state.destroyedConnections;
  const initialReleasedConnections = client.pool.state.releasedConnections;

  client.pool.state.failOrders = true;
  client.pool.state.failPaymentRollback = true;
  const response = await client.request("PATCH", "/api/admin/orders/1/payment-status", undefined, cookie);

  assert.equal(response.status, 500);
  assert.equal(client.pool.state.destroyedConnections, initialDestroyedConnections + 1);
  assert.equal(client.pool.state.releasedConnections, initialReleasedConnections);
  assert.equal(client.pool.state.orders[0].payment_status, "Pending");
  assert.equal(client.pool.state.orders[0].order_status, "Order Placed");
  assert.doesNotMatch(response.body, /private rollback detail|ER_TEST_ROLLBACK_FAILURE/);
});

test("admin COD payment recording serializes duplicate attempts so only one update succeeds", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));

  const results = await Promise.all([
    client.request("PATCH", "/api/admin/orders/1/payment-status", undefined, cookie),
    client.request("PATCH", "/api/admin/orders/1/payment-status", undefined, cookie)
  ]);

  const successful = results.filter((response) => response.status === 200).length;
  assert.equal(successful, 1);
  assert.equal(client.pool.state.orders[0].payment_status, "Paid");
  assert.equal(client.pool.state.orders[0].order_status, "Order Placed");
});

test("admin sends status emails after each actual forward and cancellation transition", async (t) => {
  const pool = createAdminPool();
  pool.state.orders[0].email = "guest@example.com";
  pool.state.orders.push({
    order_id: 4, customer_id: null, order_number: "DB-CANCEL-004",
    customer_name: "Cancellation Guest", mobile_number: "6666666666",
    email: "cancel@example.com", delivery_address: "Guest address",
    city: "Delhi", pin_code: "110003", created_at: "2026-03-13T10:00:00.000Z",
    total_amount: "700.00", payment_method: "COD", payment_status: "Pending",
    order_status: "Processing"
  });
  const notifications = [];
  const client = await startServer(t, pool, {
    sendOrderStatusUpdateEmail: async (notification) => {
      assert.equal(pool.state.statusCommitCount, initialCommitCount + notifications.length + 1);
      notifications.push(notification);
    }
  });
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));
  const initialCommitCount = pool.state.statusCommitCount;
  const transitions = ["Confirmed", "Processing", "Ready for Dispatch", "Shipped", "Delivered"];

  for (const orderStatus of transitions) {
    const response = await client.request("PATCH", "/api/admin/orders/1/status", {
      orderStatus
    }, cookie);
    assert.equal(response.status, 200);
  }
  const cancellation = await client.request("PATCH", "/api/admin/orders/4/status", {
    orderStatus: "Cancelled"
  }, cookie);
  assert.equal(cancellation.status, 200);

  assert.equal(notifications.length, 6);
  assert.deepEqual(notifications.slice(0, 5).map(({ order }) => order.orderStatus), transitions);
  assert.equal(notifications[0].email, "guest@example.com");
  assert.equal(notifications[0].order.previousStatus, "Order Placed");
  assert.equal(notifications[0].order.totalAmount, 1000);
  assert.equal(notifications[0].order.items[0].productName, "Meera Floral Kurti");
  assert.equal(notifications[4].order.orderStatus, "Delivered");
  assert.equal(notifications[5].email, "cancel@example.com");
  assert.equal(notifications[5].order.orderStatus, "Cancelled");
});

test("registered status emails use the current account email", async (t) => {
  const notifications = [];
  const client = await startServer(t, undefined, {
    sendOrderStatusUpdateEmail: async (notification) => notifications.push(notification)
  });
  await createAdmin(client.pool);
  client.pool.state.orders[1].order_status = "Shipped";
  client.pool.state.orders[1].email = "old-order-email@example.com";
  client.pool.state.customers[0].email = "current-account@example.com";
  const cookie = cookieFrom(await login(client));
  const response = await client.request("PATCH", "/api/admin/orders/2/status", {
    orderStatus: "Delivered"
  }, cookie);

  assert.equal(response.status, 200);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].email, "current-account@example.com");
  assert.equal(notifications[0].order.orderStatus, "Delivered");
});

test("admin status notifications skip no-ops and invalid transitions, and SMTP failure preserves updates", async (t) => {
  let shouldFail = false;
  const notifications = [];
  const client = await startServer(t, undefined, {
    sendOrderStatusUpdateEmail: async (notification) => {
      notifications.push(notification);
      if (shouldFail) {
        const error = new Error("private SMTP detail");
        error.code = "ECONNECTION";
        throw error;
      }
    }
  });
  await createAdmin(client.pool);
  client.pool.state.orders[0].email = "guest@example.com";
  const cookie = cookieFrom(await login(client));
  const initialCommitCount = client.pool.state.statusCommitCount;
  const noOp = await client.request("PATCH", "/api/admin/orders/1/status", {
    orderStatus: "Order Placed"
  }, cookie);
  const invalid = await client.request("PATCH", "/api/admin/orders/1/status", {
    orderStatus: "Dispatched"
  }, cookie);
  const skipped = await client.request("PATCH", "/api/admin/orders/1/status", {
    orderStatus: "Shipped"
  }, cookie);
  assert.equal(noOp.status, 200);
  assert.equal(invalid.status, 400);
  assert.equal(skipped.status, 409);
  assert.equal(notifications.length, 0);

  shouldFail = true;
  const originalError = console.error;
  const loggedErrors = [];
  console.error = (...values) => loggedErrors.push(values);
  let confirmed;
  try {
    confirmed = await client.request("PATCH", "/api/admin/orders/1/status", {
      orderStatus: "Confirmed"
    }, cookie);
  } finally {
    console.error = originalError;
  }
  assert.equal(confirmed.status, 200);
  assert.equal(client.pool.state.orders[0].order_status, "Confirmed");
  assert.equal(client.pool.state.statusCommitCount, initialCommitCount + 2);
  assert.equal(notifications.length, 1);
  assert.deepEqual(loggedErrors, [["Order status email delivery failed:", "ECONNECTION"]]);
  assert.doesNotMatch(JSON.stringify(loggedErrors), /guest@example.com|private SMTP detail/);
});

test("admin mutation rejects foreign origins and database errors do not leak internals", async (t) => {
  const client = await startServer(t);
  await createAdmin(client.pool);
  const cookie = cookieFrom(await login(client));
  const blocked = await client.request(
    "PATCH",
    "/api/admin/orders/1/status",
    { orderStatus: "Confirmed" },
    cookie,
    "http://attacker.example"
  );
  assert.equal(blocked.status, 403);

  client.pool.state.failOrders = true;
  const error = await client.request("GET", "/api/admin/dashboard", undefined, cookie);
  assert.equal(error.status, 500);
  assert.doesNotMatch(error.body, /private database detail|ER_TEST_FAILURE/);
});
