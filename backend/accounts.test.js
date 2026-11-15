const assert = require("node:assert/strict");
const { scryptSync } = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const { createServer } = require("./server");

const origin = "http://127.0.0.1:5500";

function createAccountPool() {
  const state = {
    customers: [],
    sessions: new Map(),
    resetTokens: new Map(),
    queries: [],
    orders: [],
    orderItems: []
  };
  let nextCustomerId = 1;
  let nextResetId = 1;

  async function execute(sql, parameters = []) {
    state.queries.push({ sql, parameters });
    if (sql.includes("INSERT INTO customers")) {
      if (state.customers.some((customer) =>
        customer.email === parameters[2] || customer.phone === parameters[1]
      )) {
        const error = new Error("duplicate customer");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      const customer = {
        customer_id: nextCustomerId++,
        name: parameters[0],
        phone: parameters[1],
        email: parameters[2],
        password_salt: parameters[3],
        password_hash: parameters[4]
      };
      state.customers.push(customer);
      return [{ insertId: customer.customer_id, affectedRows: 1 }, []];
    }

    if (sql.includes("FROM customers") && sql.includes("WHERE")) {
      const column = /WHERE\s+(email|phone)\s*=\s*\?/i.exec(sql)?.[1];
      const customer = column
        ? state.customers.find((entry) => entry[column] === parameters[0])
        : null;
      return [customer ? [{ ...customer }] : [], []];
    }

    if (sql.includes("INSERT INTO customer_sessions")) {
      state.sessions.set(parameters[1], {
        customer_id: parameters[0],
        expires_at: parameters[2]
      });
      return [{ insertId: state.sessions.size, affectedRows: 1 }, []];
    }

    if (sql.includes("INSERT INTO customer_password_resets")) {
      const reset = {
        reset_id: nextResetId++,
        customer_id: parameters[0],
        token_hash: parameters[1],
        expires_at: parameters[2],
        used_at: null
      };
      state.resetTokens.set(reset.token_hash, reset);
      return [{ insertId: reset.reset_id, affectedRows: 1 }, []];
    }

    if (sql.includes("FROM customer_password_resets") &&
        sql.includes("WHERE reset_id = ?") && sql.includes("FOR UPDATE")) {
      const reset = [...state.resetTokens.values()].find((entry) =>
        entry.reset_id === Number(parameters[0])
      );
      const expiresAt = reset
        ? new Date(`${reset.expires_at.replace(" ", "T")}Z`)
        : new Date(0);
      return [reset && !reset.used_at && expiresAt > new Date()
        ? [{ reset_id: reset.reset_id }]
        : [], []];
    }

    if (sql.includes("FROM customer_password_resets") && sql.includes("FOR UPDATE")) {
      const reset = state.resetTokens.get(parameters[0]);
      const expiresAt = reset
        ? new Date(`${reset.expires_at.replace(" ", "T")}Z`)
        : new Date(0);
      return [reset && !reset.used_at && expiresAt > new Date()
        ? [{ reset_id: reset.reset_id, customer_id: reset.customer_id }]
        : [], []];
    }

    if (sql.includes("UPDATE customer_password_resets") && sql.includes("WHERE reset_id = ?")) {
      const reset = [...state.resetTokens.values()].find((entry) =>
        entry.reset_id === Number(parameters[0])
      );
      if (!reset || reset.used_at) return [{ affectedRows: 0 }, []];
      reset.used_at = new Date().toISOString();
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("UPDATE customer_password_resets") && sql.includes("WHERE customer_id = ?")) {
      let affectedRows = 0;
      for (const reset of state.resetTokens.values()) {
        if (reset.customer_id === Number(parameters[0]) && !reset.used_at) {
          reset.used_at = new Date().toISOString();
          affectedRows += 1;
        }
      }
      return [{ affectedRows }, []];
    }

    if (sql.includes("UPDATE customers") && sql.includes("password_salt")) {
      const customer = state.customers.find((entry) =>
        entry.customer_id === Number(parameters[2])
      );
      if (!customer) return [{ affectedRows: 0 }, []];
      customer.password_salt = parameters[0];
      customer.password_hash = parameters[1];
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("DELETE FROM customer_sessions WHERE customer_id = ?")) {
      let affectedRows = 0;
      for (const [tokenHash, session] of state.sessions) {
        if (session.customer_id === Number(parameters[0])) {
          state.sessions.delete(tokenHash);
          affectedRows += 1;
        }
      }
      return [{ affectedRows }, []];
    }

    if (sql.includes("FROM customer_sessions s")) {
      const session = state.sessions.get(parameters[0]);
      const customer = session && new Date(`${session.expires_at.replace(" ", "T")}Z`) > new Date()
        ? state.customers.find((entry) => entry.customer_id === session.customer_id)
        : null;
      return [customer ? [{
        customer_id: customer.customer_id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email
      }] : [], []];
    }

    if (sql.includes("DELETE FROM customer_sessions")) {
      return [{ affectedRows: state.sessions.delete(parameters[0]) ? 1 : 0 }, []];
    }

    if (sql.includes("UPDATE customers SET")) {
      const customer = state.customers.find((entry) => entry.customer_id === parameters[3]);
      if (!customer) return [{ affectedRows: 0 }, []];
      customer.name = parameters[0];
      customer.phone = parameters[1];
      customer.email = parameters[2];
      return [{ affectedRows: 1 }, []];
    }

    if (sql.includes("FROM orders") && sql.includes("WHERE customer_id = ?") &&
        sql.includes("ORDER BY created_at")) {
      return [state.orders
        .filter((order) => order.customer_id === parameters[0])
        .map((order) => ({ ...order })), []];
    }

    if (sql.includes("FROM orders") && sql.includes("WHERE order_id = ? AND customer_id = ?")) {
      const order = state.orders.find((entry) =>
        entry.order_id === Number(parameters[0]) &&
        entry.customer_id === Number(parameters[1])
      );
      return [order ? [{ ...order }] : [], []];
    }

    if (sql.includes("FROM order_items")) {
      return [state.orderItems
        .filter((item) => item.order_id === Number(parameters[0]))
        .map(({ product_name_snapshot, selected_size, quantity, order_item_id }) => ({
          product_name_snapshot, selected_size, quantity, order_item_id
        })), []];
    }

    const error = new Error(`Unexpected account SQL: ${sql}`);
    error.code = "MOCK_UNEXPECTED_SQL";
    throw error;
  }

  return {
    state,
    execute,
    async getConnection() {
      return {
        beginTransaction: async () => {},
        execute,
        commit: async () => {},
        rollback: async () => {},
        release: () => {}
      };
    }
  };
}

async function startServer(t, pool = createAccountPool(), options = {}) {
  const server = createServer({
    pool,
    testDatabaseConnection: async () => true,
    sendCustomerLoginNotification: async () => {},
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const port = server.address().port;

  async function request(method, path, body, cookie, requestOrigin = origin) {
    return new Promise((resolve, reject) => {
      const content = body === undefined ? undefined : JSON.stringify(body);
      const headers = {};
      if (requestOrigin) headers.origin = requestOrigin;
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
  return { pool, request, port };
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

test("account route registration keeps GET /api/account/me out of the 404 fallback", async (t) => {
  const client = await startServer(t);
  const response = await client.request("GET", "/api/account/me");

  assert.equal(response.status, 401);
  assert.deepEqual(parseBody(response), {
    success: false,
    message: "Please sign in to continue."
  });
  assert.equal(response.body.includes("Route not found"), false);
});

test("registration and login hash passwords and use private HTTP-only sessions", async (t) => {
  const client = await startServer(t);
  const password = "dazzle-pass-26";
  const registration = await client.request("POST", "/api/account/register", {
    name: "Account Customer",
    phone: "+91 99999-99999",
    email: "Customer@Example.com",
    password
  });
  assert.equal(registration.status, 200, registration.body);
  const customer = client.pool.state.customers[0];
  const registrationCookie = cookieFrom(registration);

  assert.equal(registration.status, 200);
  assert.equal(customer.phone, "9999999999");
  assert.equal(customer.email, "customer@example.com");
  assert.equal(customer.password_hash.length, 128);
  assert.notEqual(customer.password_hash, password);
  assert.equal(customer.password_salt.length, 32);
  assert.match(String(registration.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(registration.headers["set-cookie"]), /SameSite=Lax/);
  assert.doesNotMatch(registration.body, /password_hash|password_salt|token/);
  assert.equal(registration.body.includes(customer.password_hash), false);

  const current = await client.request("GET", "/api/account/me", undefined, registrationCookie);
  assert.equal(current.status, 200);
  assert.deepEqual(Object.keys(parseBody(current).customer).sort(), [
    "customerId", "email", "name", "phone"
  ]);

  const login = await client.request("POST", "/api/account/login", {
    identifier: " +91 99999-99999 ",
    password
  });
  assert.equal(login.status, 200);
  assert.match(String(login.headers["set-cookie"]), /HttpOnly/);

  const invalidLogin = await client.request("POST", "/api/account/login", {
    identifier: "customer@example.com",
    password: "incorrect password"
  });
  assert.equal(invalidLogin.status, 401);
  assert.equal(parseBody(invalidLogin).message, "The email/phone or password is incorrect.");

  const logout = await client.request("POST", "/api/account/logout", undefined, registrationCookie);
  assert.equal(logout.status, 200);
  assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
  const afterLogout = await client.request("GET", "/api/account/me", undefined, registrationCookie);
  assert.equal(afterLogout.status, 401);
});

test("customer login notifications are sent only after successful login", async (t) => {
  const notifications = [];
  const client = await startServer(t, undefined, {
    sendCustomerLoginNotification: async (notification) => notifications.push(notification)
  });
  const password = "dazzle-pass-26";
  const registration = await client.request("POST", "/api/account/register", {
    name: "Login Notification Customer",
    phone: "9999999911",
    email: "login-notice@example.com",
    password
  });
  assert.equal(registration.status, 200);
  assert.equal(notifications.length, 0);

  const failedLogin = await client.request("POST", "/api/account/login", {
    identifier: "login-notice@example.com",
    password: "incorrect-password"
  });
  assert.equal(failedLogin.status, 401);
  assert.equal(notifications.length, 0);

  const successfulLogin = await client.request("POST", "/api/account/login", {
    identifier: "login-notice@example.com",
    password
  });
  assert.equal(successfulLogin.status, 200);
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0] && Object.keys(notifications[0]).sort(), ["email", "loginAt"]);
  assert.equal(notifications[0].email, "login-notice@example.com");
  assert.equal(Number.isFinite(Date.parse(notifications[0].loginAt)), true);
});

test("customer login SMTP failures do not undo a successful login", async (t) => {
  const client = await startServer(t, undefined, {
    sendCustomerLoginNotification: async () => {
      const error = new Error("private SMTP detail");
      error.code = "ECONNECTION";
      throw error;
    }
  });
  const registration = await client.request("POST", "/api/account/register", {
    name: "SMTP Failure Customer",
    phone: "9999999912",
    email: "smtp-failure@example.com",
    password: "dazzle-pass-26"
  });
  assert.equal(registration.status, 200);

  const originalError = console.error;
  const loggedErrors = [];
  console.error = (...values) => loggedErrors.push(values);
  let login;
  try {
    login = await client.request("POST", "/api/account/login", {
      identifier: "smtp-failure@example.com",
      password: "dazzle-pass-26"
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(login.status, 200);
  assert.equal(client.pool.state.sessions.size, 2);
  assert.deepEqual(loggedErrors, [["Customer login email delivery failed:", "ECONNECTION"]]);
  assert.doesNotMatch(JSON.stringify(loggedErrors), /smtp-failure@example.com|private SMTP detail/);
});

test("customer login accepts existing passwords longer than 16 characters", async (t) => {
  const client = await startServer(t);
  const registration = await client.request("POST", "/api/account/register", {
    name: "Legacy Customer",
    phone: "9999999999",
    email: "legacy@example.com",
    password: "valid-pass"
  });
  assert.equal(registration.status, 200);

  const legacyPassword = "legacy-customer-password";
  assert.ok(legacyPassword.length > 16);
  const salt = Buffer.alloc(16, 0x37);
  const customer = client.pool.state.customers[0];
  customer.password_salt = salt.toString("hex");
  customer.password_hash = scryptSync(legacyPassword, salt, 64).toString("hex");

  const login = await client.request("POST", "/api/account/login", {
    identifier: "legacy@example.com",
    password: legacyPassword
  });
  assert.equal(login.status, 200, login.body);
});

test("customer registration accepts 7 and 16 character passwords and rejects 6 or 17", async (t) => {
  const client = await startServer(t);
  const passwords = [
    { length: 7, accepted: true },
    { length: 6, accepted: false },
    { length: 16, accepted: true },
    { length: 17, accepted: false }
  ];

  for (const [index, item] of passwords.entries()) {
    const response = await client.request("POST", "/api/account/register", {
      name: `Customer ${index}`,
      phone: `99999999${String(index).padStart(2, "0")}`,
      email: `customer${index}@example.com`,
      password: "p".repeat(item.length)
    });
    assert.equal(response.status, item.accepted ? 200 : 400);
    if (!item.accepted) {
      assert.match(parseBody(response).message, /7 and 16 characters/);
    }
  }
});

test("customer password reset accepts 7 and 16 characters and rejects 6 or 17", async (t) => {
  let deliveredToken;
  const client = await startServer(t, undefined, {
    passwordResetEmailConfigured: true,
    passwordResetRequestLimit: 10,
    sendPasswordResetEmail: async ({ token }) => {
      deliveredToken = token;
    }
  });
  await client.request("POST", "/api/account/register", {
    name: "Reset Boundary Customer",
    phone: "9999999999",
    email: "reset-boundary@example.com",
    password: "valid-pass"
  });

  for (const [index, item] of [
    { length: 7, accepted: true },
    { length: 16, accepted: true },
    { length: 6, accepted: false },
    { length: 17, accepted: false }
  ].entries()) {
    await client.request("POST", "/api/account/forgot-password", {
      email: "reset-boundary@example.com"
    });
    const response = await client.request("POST", "/api/account/reset-password", {
      token: deliveredToken,
      password: "p".repeat(item.length)
    });
    assert.equal(response.status, item.accepted ? 200 : 400, `case ${index}: ${response.body}`);
    if (!item.accepted) {
      assert.match(parseBody(response).message, /7 and 16 characters/);
    }
  }
});

test("customer password recovery hides account existence and sends only a single-use token", async (t) => {
  let deliveredToken;
  const client = await startServer(t, undefined, {
    passwordResetEmailConfigured: true,
    sendPasswordResetEmail: async ({ email, token }) => {
      assert.equal(email, "customer@example.com");
      deliveredToken = token;
    }
  });
  const registration = await client.request("POST", "/api/account/register", {
    name: "Reset Customer",
    phone: "9999999999",
    email: "customer@example.com",
    password: "old-pass-2026"
  });
  const oldCookie = cookieFrom(registration);
  assert.equal((await client.request("GET", "/api/account/me", undefined, oldCookie)).status, 200);

  const known = await client.request("POST", "/api/account/forgot-password", {
    email: "customer@example.com"
  });
  const unknown = await client.request("POST", "/api/account/forgot-password", {
    email: "unknown@example.com"
  });
  assert.equal(known.status, 200);
  assert.deepEqual(parseBody(known), parseBody(unknown));
  assert.equal(typeof deliveredToken, "string");
  assert.equal(known.body.includes(deliveredToken), false);

  const resetRecord = [...client.pool.state.resetTokens.values()][0];
  assert.equal(resetRecord.token_hash.length, 64);
  assert.notEqual(resetRecord.token_hash, deliveredToken);
  assert.equal(client.pool.state.resetTokens.has(deliveredToken), false);

  const reset = await client.request("POST", "/api/account/reset-password", {
    token: deliveredToken,
    password: "new-pass"
  });
  assert.equal(reset.status, 200, reset.body);
  assert.match(parseBody(reset).message, /sign in again/);
  assert.notEqual(resetRecord.used_at, null);
  assert.equal(client.pool.state.sessions.size, 0);
  assert.equal((await client.request("GET", "/api/account/me", undefined, oldCookie)).status, 401);

  const customer = client.pool.state.customers[0];
  const passwordHashAfterFirstReset = customer.password_hash;
  const passwordSaltAfterFirstReset = customer.password_salt;
  const replayPassword = "another-new-pass";
  const reused = await client.request("POST", "/api/account/reset-password", {
    token: deliveredToken,
    password: replayPassword
  });
  assert.equal(reused.status, 400);
  assert.match(parseBody(reused).message, /invalid or has expired/);
  assert.equal(customer.password_hash, passwordHashAfterFirstReset);
  assert.equal(customer.password_salt, passwordSaltAfterFirstReset);

  const loginWithFirstPassword = await client.request("POST", "/api/account/login", {
    identifier: "customer@example.com",
    password: "new-pass"
  });
  assert.equal(loginWithFirstPassword.status, 200);
  const loginWithReplayPassword = await client.request("POST", "/api/account/login", {
    identifier: "customer@example.com",
    password: replayPassword
  });
  assert.equal(loginWithReplayPassword.status, 401);
});

test("expired customer password reset tokens are rejected", async (t) => {
  let deliveredToken;
  const client = await startServer(t, undefined, {
    passwordResetEmailConfigured: true,
    sendPasswordResetEmail: async ({ token }) => {
      deliveredToken = token;
    }
  });
  await client.request("POST", "/api/account/register", {
    name: "Expiry Customer",
    phone: "9999999999",
    email: "expiry@example.com",
    password: "valid-password"
  });
  const oldPasswordHash = client.pool.state.customers[0].password_hash;
  await client.request("POST", "/api/account/forgot-password", { email: "expiry@example.com" });
  const reset = client.pool.state.resetTokens.values().next().value;
  reset.expires_at = "2000-01-01 00:00:00";

  const response = await client.request("POST", "/api/account/reset-password", {
    token: deliveredToken,
    password: "new-password"
  });
  assert.equal(response.status, 400);
  assert.equal(client.pool.state.customers[0].password_hash, oldPasswordHash);
});

test("password recovery fails safely when SMTP is unavailable and handles delivery errors generically", async (t) => {
  const unconfigured = await startServer(t);
  const before = unconfigured.pool.state.queries?.length || 0;
  const unavailable = await unconfigured.request("POST", "/api/account/forgot-password", {
    email: "unknown@example.com"
  });
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(unavailable.body, /sent/i);
  assert.equal(unconfigured.pool.state.queries.length, before);

  const failedDelivery = await startServer(t, undefined, {
    passwordResetEmailConfigured: true,
    sendPasswordResetEmail: async () => {
      const error = new Error("private smtp error");
      error.code = "SMTP_TEST_FAILURE";
      throw error;
    }
  });
  await failedDelivery.request("POST", "/api/account/register", {
    name: "Mail Failure Customer",
    phone: "9999999999",
    email: "mail-failure@example.com",
    password: "valid-password"
  });
  const response = await failedDelivery.request("POST", "/api/account/forgot-password", {
    email: "mail-failure@example.com"
  });
  assert.equal(response.status, 200);
  assert.match(parseBody(response).message, /if email delivery is available/);
  assert.equal([...failedDelivery.pool.state.resetTokens.values()][0].used_at !== null, true);
  assert.doesNotMatch(response.body, /private smtp error|SMTP_TEST_FAILURE/);
});

test("password recovery requests are rate limited", async (t) => {
  const client = await startServer(t, undefined, {
    passwordResetRequestLimit: 1,
    passwordResetEmailConfigured: true,
    sendPasswordResetEmail: async () => {}
  });
  const payload = { email: "missing@example.com" };
  assert.equal((await client.request("POST", "/api/account/forgot-password", payload)).status, 200);
  assert.equal((await client.request("POST", "/api/account/forgot-password", payload)).status, 429);
});

test("password reset token attempts are rate limited", async (t) => {
  const client = await startServer(t, undefined, { passwordResetSubmitLimit: 1 });
  const invalid = {
    token: "A".repeat(43),
    password: "valid-password"
  };
  assert.equal((await client.request("POST", "/api/account/reset-password", invalid)).status, 400);
  assert.equal((await client.request("POST", "/api/account/reset-password", invalid)).status, 429);
});

test("profile editing, order history and details enforce account ownership", async (t) => {
  const client = await startServer(t);
  const registration = await client.request("POST", "/api/account/register", {
    name: "First Customer",
    phone: "9999999999",
    email: "first@example.com",
    password: "first-pass-2026"
  });
  const cookie = cookieFrom(registration);
  const first = client.pool.state.customers[0];
  client.pool.state.customers.push({
    customer_id: 2,
    name: "Other Customer",
    phone: "8888888888",
    email: "other@example.com",
    password_salt: "0".repeat(32),
    password_hash: "0".repeat(128)
  });

  client.pool.state.orders.push(
    {
      order_id: 1, customer_id: first.customer_id, order_number: "DB-OWNED-1",
      created_at: new Date("2026-01-02T10:00:00Z"), total_amount: "1499.00",
      payment_method: "COD", payment_status: "Pending", order_status: "Processing",
      customer_name: first.name, mobile_number: first.phone, email: first.email
    },
    {
      order_id: 2, customer_id: 2, order_number: "DB-OTHER-2",
      created_at: new Date("2026-01-03T10:00:00Z"), total_amount: "2999.00",
      payment_method: "COD", payment_status: "Pending", order_status: "Order Placed"
    },
    {
      order_id: 3, customer_id: first.customer_id, order_number: "DB-OWNED-3",
      created_at: new Date("2026-01-04T10:00:00Z"), total_amount: "999.00",
      payment_method: "COD", payment_status: "Paid", order_status: "Delivered"
    }
  );
  client.pool.state.orderItems.push({
    order_id: 1, order_item_id: 1, product_name_snapshot: "Meera Floral Kurti",
    selected_size: "M", quantity: 1
  });

  const update = await client.request("PATCH", "/api/account/me", {
    name: "Updated Customer",
    phone: "9999999999",
    email: "updated@example.com"
  }, cookie);
  assert.equal(update.status, 200);
  assert.equal(parseBody(update).customer.name, "Updated Customer");

  const history = await client.request("GET", "/api/account/orders", undefined, cookie);
  assert.equal(history.status, 200);
  assert.deepEqual(parseBody(history).orders.map((order) => [
    order.orderNumber,
    order.paymentStatus
  ]).sort(([left], [right]) => left.localeCompare(right)), [
    ["DB-OWNED-1", "Pending"],
    ["DB-OWNED-3", "Paid"]
  ]);
  assert.doesNotMatch(history.body, /customer_name|mobile_number|email/);

  const details = await client.request("GET", "/api/account/orders/1", undefined, cookie);
  assert.equal(details.status, 200);
  assert.deepEqual(parseBody(details).order.items, [{
    productName: "Meera Floral Kurti", size: "M", quantity: 1
  }]);
  assert.doesNotMatch(details.body, /mobile_number|delivery_address|password_hash/);

  const foreignDetails = await client.request("GET", "/api/account/orders/2", undefined, cookie);
  assert.equal(foreignDetails.status, 404);
  assert.equal(parseBody(foreignDetails).message, "The requested order was not found.");
});

test("account mutations reject a foreign origin and routes require a session", async (t) => {
  const client = await startServer(t, undefined, { accountAttemptLimit: 2 });
  const unauthorized = await client.request("GET", "/api/account/orders");
  assert.equal(unauthorized.status, 401);

  const blocked = await client.request("POST", "/api/account/register", {
      name: "Blocked",
      phone: "9999999999",
      email: "blocked@example.com",
      password: "blocked-pass-26"
    }, undefined, "http://attacker.example");
  assert.equal(blocked.status, 403);
  assert.equal(client.pool.state.customers.length, 0);

  const badLogin = {
    identifier: "9999999999",
    password: "incorrect password"
  };
  assert.equal((await client.request("POST", "/api/account/login", badLogin)).status, 401);
  assert.equal((await client.request("POST", "/api/account/login", badLogin)).status, 401);
  assert.equal((await client.request("POST", "/api/account/login", badLogin)).status, 429);
});
