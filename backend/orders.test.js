const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createServer } = require("./server");

const validPayload = {
  customer: {
    name: "Test Customer",
    phone: "9999999999",
    email: "test@example.com",
    address: "Test House, Test Street",
    city: "Ghaziabad",
    pincode: "201001"
  },
  items: [{ productId: "meera-floral-kurti", size: "M", quantity: 1 }]
};

function createMockPool({
  products,
  failOn,
  collisions = 0,
  failRollback = false,
  idempotencyCollision = false,
  trackingOrders,
  trackingItems,
  failTrackingDatabase = false,
  availabilityProducts,
  availabilitySizes,
  failAvailabilityDatabase = false,
  sizeStocks,
  authenticatedCustomer
} = {}) {
  const stock = new Map(Object.entries(products || {
    "meera-floral-kurti": {
      product_id: "meera-floral-kurti",
      product_name: "Meera Floral Kurti",
      current_price: "1499.00",
      stock_quantity: 5,
      is_active: 1
    },
    "madhuri-woven-saree": {
      product_id: "madhuri-woven-saree",
      product_name: "Madhuri Woven Saree",
      current_price: "3799.00",
      stock_quantity: 8,
      is_active: 1
    }
  }));
  const variantStock = new Map(Object.entries(sizeStocks || {
    "meera-floral-kurti\u0000M": 2,
    "meera-floral-kurti\u0000S": 1,
    "meera-floral-kurti\u0000XS": 0,
    "madhuri-woven-saree\u0000Free Size": 8
  }));
  const rowLocks = new Map();
  const state = {
    committed: false,
    released: false,
    destroyed: false,
    rolledBack: false,
    rollbackCount: 0,
    beginCount: 0,
    orderItems: [],
    orders: [],
    variantLockOrder: [],
    idempotencyRecords: new Map(),
    idempotencyDuplicateCount: 0,
    orderNumberDuplicateCount: 0,
    trackingQueries: [],
    authenticatedCustomer,
    trackingOrders: trackingOrders || [{
      order_id: 7,
      order_number: "DB-0123456789abcdef01234567",
      mobile_number: "+91 99999-99999",
      customer_name: "Private Customer",
      email: "private@example.com",
      delivery_address: "Private Address",
      pin_code: "201001",
      idempotency_key: "private-key",
      request_fingerprint: "private-fingerprint",
      created_at: new Date("2026-11-12T10:00:00.000Z"),
      total_amount: "1499.00",
      payment_method: "COD",
      payment_status: "Pending",
      order_status: "Order Placed"
    }],
    trackingItems: trackingItems || [{
      product_name_snapshot: "Meera Floral Kurti",
      selected_size: "M",
      quantity: 1
    }],
    availabilityQueries: [],
    availabilityProducts: new Map(Object.entries(availabilityProducts || {
      "meera-floral-kurti": { product_id: "meera-floral-kurti", is_active: 1 },
      "madhuri-woven-saree": { product_id: "madhuri-woven-saree", is_active: 1 }
    })),
    availabilitySizes: new Map(Object.entries(availabilitySizes || {
      "meera-floral-kurti": [
        { size: "XS", stock_quantity: 0 },
        { size: "S", stock_quantity: 1 },
        { size: "M", stock_quantity: 2 },
        { size: "L", stock_quantity: 1 }
      ],
      "madhuri-woven-saree": [
        { size: "Free Size", stock_quantity: 8 }
      ]
    })),
    failAvailabilityDatabase,
    stock,
    variantStock
  };
  let pendingOrders = [];
  let pendingItems = [];
  const pendingIdempotencyKeys = new Map();

  async function lockRow(key) {
    let unlock;
    const currentLock = new Promise((resolve) => {
      unlock = resolve;
    });
    const previousLock = rowLocks.get(key);
    rowLocks.set(key, currentLock);
    if (previousLock) await previousLock;
    return () => {
      unlock();
      if (rowLocks.get(key) === currentLock) {
        rowLocks.delete(key);
      }
    };
  }

  function duplicateError(indexName) {
    const error = new Error(`Duplicate entry for key 'orders.${indexName}'`);
    error.code = "ER_DUP_ENTRY";
    error.sqlMessage = error.message;
    return error;
  }

  return {
    state,
    async execute(sql, parameters) {
      if (sql.includes("FROM customer_sessions s")) {
        return [authenticatedCustomer ? [{
          customer_id: authenticatedCustomer.customer_id,
          name: authenticatedCustomer.name,
          phone: authenticatedCustomer.phone,
          email: authenticatedCustomer.email
        }] : [], []];
      }
      if (sql.includes("FROM storefront_products") && sql.includes("is_active = 1")) {
        state.availabilityQueries.push({ sql, parameters });
        if (failAvailabilityDatabase) throw new Error("private database detail");
        const product = state.availabilityProducts.get(parameters[0]);
        return [product && Number(product.is_active) === 1 ? [{ ...product }] : [], []];
      }
      if (sql.includes("FROM storefront_product_sizes")) {
        state.availabilityQueries.push({ sql, parameters });
        if (failAvailabilityDatabase) throw new Error("private database detail");
        const rows = state.availabilitySizes.get(parameters[0]) || [];
        return [rows.map((row) => ({ ...row })), []];
      }
      state.trackingQueries.push({ sql, parameters });
      if (failTrackingDatabase) throw new Error("private database detail");
      if (sql.includes("FROM orders") && sql.includes("WHERE order_number")) {
        const order = state.trackingOrders.find((entry) => entry.order_number === parameters[0]);
        return [order ? [{ ...order }] : [], []];
      }
      if (sql.includes("FROM order_items")) {
        return [state.trackingItems.map((item) => ({ ...item })), []];
      }
      throw new Error(`Unexpected tracking SQL in test: ${sql}`);
    },
    async getConnection() {
      let pendingIdempotencyKey = null;
      let pendingIdempotencyGate = null;
      let pendingVariantStocks = new Map();
      const releaseRowLocks = [];
      return {
        async beginTransaction() {
          state.beginCount += 1;
          if (failOn === "begin") throw new Error("mock database failure");
          pendingOrders = [];
          pendingItems = [];
          pendingVariantStocks = new Map();
        },
        async execute(sql, parameters) {
          if (sql.includes("FROM orders") && sql.includes("WHERE idempotency_key")) {
            const order = state.idempotencyRecords.get(parameters[0]);
            return [order ? [{ ...order }] : [], []];
          }
          if (sql.includes("FROM storefront_product_sizes") && sql.includes("FOR UPDATE")) {
            const key = `${parameters[0]}\u0000${parameters[1]}`;
            state.variantLockOrder.push(key);
            releaseRowLocks.push(await lockRow(`size:${key}`));
            const quantity = pendingVariantStocks.has(key)
              ? pendingVariantStocks.get(key)
              : variantStock.get(key);
            return [quantity === undefined ? [] : [{
              product_id: parameters[0],
              size: parameters[1],
              stock_quantity: quantity
            }], []];
          }
          if (sql.includes("FROM storefront_products") && sql.includes("WHERE product_id = ?")) {
            releaseRowLocks.push(await lockRow(`product:${parameters[0]}`));
            const product = stock.get(parameters[0]);
            return [product ? [{ ...product }] : [], []];
          }
          if (sql.includes("INSERT INTO orders")) {
            if (collisions > 0) {
              collisions -= 1;
              state.orderNumberDuplicateCount += 1;
              throw duplicateError("uq_orders_order_number");
            }
            if (failOn === "order-insert") throw new Error("mock database failure");
            const idempotencyKey = parameters[9];
            if (idempotencyCollision) {
              idempotencyCollision = false;
              state.idempotencyDuplicateCount += 1;
              const existingOrder = {
                customer_id: parameters[0],
                order_number: parameters[1],
                total_amount: parameters[8],
                payment_method: "COD",
                payment_status: "Pending",
                order_status: "Order Placed",
                idempotency_key: idempotencyKey,
                request_fingerprint: parameters[10]
              };
              state.idempotencyRecords.set(idempotencyKey, existingOrder);
              state.orders.push(existingOrder);
              throw duplicateError("uq_orders_idempotency_key");
            }
            if (state.idempotencyRecords.has(idempotencyKey)) {
              state.idempotencyDuplicateCount += 1;
              throw duplicateError("uq_orders_idempotency_key");
            }
            const pending = pendingIdempotencyKeys.get(idempotencyKey);
            if (pending) {
              await pending.promise;
              if (state.idempotencyRecords.has(idempotencyKey)) {
                state.idempotencyDuplicateCount += 1;
                throw duplicateError("uq_orders_idempotency_key");
              }
              return this.execute(sql, parameters);
            }

            pendingIdempotencyGate = {};
            pendingIdempotencyGate.promise = new Promise((resolve) => {
              pendingIdempotencyGate.resolve = resolve;
            });
            pendingIdempotencyKeys.set(idempotencyKey, pendingIdempotencyGate);
            pendingIdempotencyKey = idempotencyKey;

            const order = {
              customer_id: parameters[0],
              order_number: parameters[1],
              email: parameters[4],
              total_amount: parameters[8],
              payment_method: "COD",
              payment_status: "Pending",
              order_status: "Order Placed",
              idempotency_key: idempotencyKey,
              request_fingerprint: parameters[10]
            };
            pendingOrders.push(order);
            return [{ insertId: state.orders.length + pendingOrders.length }, []];
          }
          if (sql.includes("INSERT INTO order_items")) {
            if (failOn === "item-insert") throw new Error("mock database failure");
            pendingItems.push(parameters);
            return [{ affectedRows: 1 }, []];
          }
          if (sql.includes("UPDATE storefront_product_sizes")) {
            if (failOn === "variant-update") throw new Error("mock database failure");
            const key = `${parameters[1]}\u0000${parameters[2]}`;
            const currentQuantity = pendingVariantStocks.has(key)
              ? pendingVariantStocks.get(key)
              : variantStock.get(key);
            if (currentQuantity === undefined || currentQuantity < parameters[0]) {
              return [{ affectedRows: 0 }, []];
            }
            pendingVariantStocks.set(key, currentQuantity - parameters[0]);
            return [{ affectedRows: 1 }, []];
          }
          throw new Error(`Unexpected SQL in test: ${sql}`);
        },
        async commit() {
          state.orders.push(...pendingOrders);
          state.orderItems.push(...pendingItems);
          for (const [key, quantity] of pendingVariantStocks) {
            variantStock.set(key, quantity);
          }
          for (const order of pendingOrders) {
            state.idempotencyRecords.set(order.idempotency_key, order);
          }
          pendingOrders = [];
          pendingItems = [];
          pendingVariantStocks.clear();
          state.committed = true;
          while (releaseRowLocks.length) releaseRowLocks.pop()();
          if (pendingIdempotencyKey) {
            pendingIdempotencyKeys.delete(pendingIdempotencyKey);
            pendingIdempotencyGate.resolve();
            pendingIdempotencyKey = null;
          }
        },
        async rollback() {
          state.rollbackCount += 1;
          if (failRollback) throw new Error("mock rollback failure");
          pendingOrders = [];
          pendingItems = [];
          pendingVariantStocks.clear();
          state.rolledBack = true;
          while (releaseRowLocks.length) releaseRowLocks.pop()();
          if (pendingIdempotencyKey) {
            pendingIdempotencyKeys.delete(pendingIdempotencyKey);
            pendingIdempotencyGate.resolve();
            pendingIdempotencyKey = null;
          }
        },
        async ping() {},
        release() {
          while (releaseRowLocks.length) releaseRowLocks.pop()();
          state.released = true;
        },
        destroy() {
          while (releaseRowLocks.length) releaseRowLocks.pop()();
          state.destroyed = true;
        }
      };
    }
  };
}

async function withServer(t, pool = createMockPool(), databaseCheck = async () => true, serverOptions = {}) {
  const server = createServer({
    sendOrderConfirmationEmail: async () => {},
    ...serverOptions,
    pool,
    testDatabaseConnection: databaseCheck
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  return {
    pool,
    request(method, path, body, headers = {}) {
      return new Promise((resolve, reject) => {
        const request = http.request({
          hostname: "127.0.0.1",
          port: address.port,
          path,
          method,
          headers
        }, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8")
            });
          });
        });
        request.on("error", reject);
        if (body !== undefined) request.write(body);
        request.end();
      });
    }
  };
}

async function getAvailability(client, productId) {
  return client.request(
    "GET",
    `/api/products/${encodeURIComponent(productId)}/availability`,
    undefined,
    { origin: "http://127.0.0.1:5500" }
  );
}

function jsonHeaders(body, idempotencyKey = "123e4567-e89b-12d3-a456-426614174000") {
  return {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "idempotency-key": idempotencyKey,
    origin: "http://127.0.0.1:5500"
  };
}

async function postOrder(client, payload, idempotencyKey, cookie) {
  const body = JSON.stringify(payload);
  const headers = jsonHeaders(body, idempotencyKey);
  if (cookie) headers.cookie = cookie;
  return client.request("POST", "/api/orders", body, headers);
}

async function postTrack(client, payload) {
  const body = JSON.stringify(payload);
  return client.request("POST", "/api/orders/track", body, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    origin: "http://127.0.0.1:5500"
  });
}

test("valid order is created from database prices and stock", async (t) => {
  const client = await withServer(t);
  const response = await postOrder(client, validPayload);
  const body = JSON.parse(response.body);

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.match(body.orderNumber, /^DB-[0-9a-f]{24}$/);
  assert.equal(body.totalAmount, 1499);
  assert.equal(body.paymentMethod, "COD");
  assert.equal(body.paymentStatus, "Pending");
  assert.equal(body.orderStatus, "Order Placed");
  assert.equal(client.pool.state.orders[0].customer_id, null);
  assert.equal(client.pool.state.orders[0].total_amount, "1499.00");
  assert.equal(client.pool.state.orders[0].idempotency_key, "123e4567-e89b-12d3-a456-426614174000");
  assert.match(client.pool.state.orders[0].request_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(client.pool.state.orderItems[0][2], "Meera Floral Kurti");
  assert.equal(client.pool.state.orderItems[0][3], "1499.00");
  assert.equal(client.pool.state.variantStock.get("meera-floral-kurti\u0000M"), 1);
  assert.equal(client.pool.state.stock.get("meera-floral-kurti").stock_quantity, 5);
  assert.equal(client.pool.state.committed, true);
  assert.equal(client.pool.state.released, true);
  assert.equal(client.pool.state.destroyed, false);
});

test("guest order confirmation is sent after commit and not resent on idempotent retry", async (t) => {
  const notifications = [];
  let client;
  client = await withServer(t, undefined, undefined, {
    sendOrderConfirmationEmail: async (notification) => {
      assert.equal(client.pool.state.committed, true);
      assert.equal(client.pool.state.orders.length, 1);
      notifications.push(notification);
    }
  });
  const idempotencyKey = "123e4567-e89b-12d3-a456-426614174051";
  const first = await postOrder(client, validPayload, idempotencyKey);
  const replay = await postOrder(client, validPayload, idempotencyKey);

  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(JSON.parse(first.body).orderNumber, JSON.parse(replay.body).orderNumber);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].email, "test@example.com");
  assert.equal(notifications[0].order.orderStatus, "Order Placed");
  assert.equal(notifications[0].order.items[0].productName, "Meera Floral Kurti");
  assert.equal(notifications[0].order.items[0].subtotal, 1499);
});

test("guest orders without a valid email are committed without sending a confirmation", async (t) => {
  const notifications = [];
  const client = await withServer(t, undefined, undefined, {
    sendOrderConfirmationEmail: async (notification) => notifications.push(notification)
  });
  const payload = structuredClone(validPayload);
  payload.customer.email = "";
  const response = await postOrder(client, payload, "123e4567-e89b-12d3-a456-426614174053");

  assert.equal(response.status, 201);
  assert.equal(client.pool.state.orders[0].email, null);
  assert.equal(notifications.length, 0);
});

test("authenticated checkout links the order to the signed-in customer", async (t) => {
  const notifications = [];
  const pool = createMockPool({
    authenticatedCustomer: {
      customer_id: 42,
      name: "Account Customer",
      phone: "9999999999",
      email: "account@example.com"
    }
  });
  const client = await withServer(t, pool, undefined, {
    sendOrderConfirmationEmail: async (notification) => notifications.push(notification)
  });
  const response = await postOrder(
    client,
    validPayload,
    "123e4567-e89b-12d3-a456-426614174099",
    `dazzle_session=${"a".repeat(43)}`
  );

  assert.equal(response.status, 201);
  assert.equal(pool.state.orders[0].customer_id, 42);
  assert.equal(pool.state.orders[0].email, "account@example.com");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].email, "account@example.com");
});

test("order email failures do not undo a committed order", async (t) => {
  let sendAttempts = 0;
  const client = await withServer(t, undefined, undefined, {
    sendOrderConfirmationEmail: async () => {
      sendAttempts += 1;
      const error = new Error("private SMTP detail");
      error.code = "ECONNECTION";
      throw error;
    }
  });
  const originalError = console.error;
  const loggedErrors = [];
  console.error = (...values) => loggedErrors.push(values);
  let response;
  try {
    response = await postOrder(client, validPayload, "123e4567-e89b-12d3-a456-426614174052");
  } finally {
    console.error = originalError;
  }

  assert.equal(response.status, 201);
  assert.equal(client.pool.state.orders.length, 1);
  assert.equal(client.pool.state.committed, true);
  assert.equal(client.pool.state.variantStock.get("meera-floral-kurti\u0000M"), 1);
  assert.equal(sendAttempts, 1);
  assert.deepEqual(loggedErrors, [["Order confirmation email delivery failed:", "ECONNECTION"]]);
  assert.doesNotMatch(JSON.stringify(loggedErrors), /test@example.com|private SMTP detail/);
});

test("missing customer field is rejected", async (t) => {
  const client = await withServer(t);
  const payload = structuredClone(validPayload);
  delete payload.customer.city;

  const response = await postOrder(client, payload);
  assert.equal(response.status, 400);
});

test("missing and invalid idempotency keys are rejected", async (t) => {
  const client = await withServer(t);
  const body = JSON.stringify(validPayload);
  const missing = await client.request("POST", "/api/orders", body, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  const invalid = await postOrder(client, validPayload, "not-a-high-entropy-key");

  assert.equal(missing.status, 400);
  assert.equal(invalid.status, 400);
  assert.equal(client.pool.state.beginCount, 0);
});

test("malformed JSON is rejected", async (t) => {
  const client = await withServer(t);
  const body = '{"customer":';
  const response = await client.request("POST", "/api/orders", body, jsonHeaders(body));
  assert.equal(response.status, 400);
});

test("empty cart is rejected", async (t) => {
  const client = await withServer(t);
  const response = await postOrder(client, { ...validPayload, items: [] });
  assert.equal(response.status, 400);
});

test("missing product is rejected", async (t) => {
  const client = await withServer(t);
  const payload = structuredClone(validPayload);
  payload.items[0].productId = "unknown-product";

  const response = await postOrder(client, payload);
  assert.equal(response.status, 404);
  assert.equal(client.pool.state.rolledBack, true);
});

test("size not offered for product is rejected", async (t) => {
  const client = await withServer(t);
  const payload = structuredClone(validPayload);
  payload.items[0].size = "Free Size";

  const response = await postOrder(client, payload);
  assert.equal(response.status, 400);
  assert.equal(client.pool.state.rolledBack, true);
});

test("invalid quantity is rejected", async (t) => {
  const client = await withServer(t);
  const payload = structuredClone(validPayload);
  payload.items[0].quantity = 0;

  const response = await postOrder(client, payload);
  assert.equal(response.status, 400);
});

test("insufficient size stock is rejected", async (t) => {
  const client = await withServer(t);
  const payload = structuredClone(validPayload);
  payload.items[0].quantity = 6;

  const response = await postOrder(client, payload);
  assert.equal(response.status, 409);
  assert.match(JSON.parse(response.body).message, /not enough stock for size M/i);
  assert.equal(client.pool.state.rolledBack, true);
  assert.equal(client.pool.state.released, true);
  assert.equal(client.pool.state.destroyed, false);
  assert.equal(client.pool.state.orders.length, 0);
  assert.equal(client.pool.state.variantStock.get("meera-floral-kurti\u0000M"), 2);
});

test("zero-stock size is rejected", async (t) => {
  const pool = createMockPool({ sizeStocks: { "meera-floral-kurti\u0000XS": 0 } });
  const client = await withServer(t, pool);
  const payload = structuredClone(validPayload);
  payload.items[0].size = "XS";

  const response = await postOrder(client, payload);
  assert.equal(response.status, 409);
  assert.match(JSON.parse(response.body).message, /size XS is out of stock/i);
  assert.equal(pool.state.orders.length, 0);
  assert.equal(pool.state.variantStock.get("meera-floral-kurti\u0000XS"), 0);
});

test("missing product-size variant is rejected", async (t) => {
  const pool = createMockPool({ sizeStocks: {} });
  const client = await withServer(t, pool);
  const response = await postOrder(client, validPayload);

  assert.equal(response.status, 409);
  assert.match(JSON.parse(response.body).message, /selected size \(M\) is unavailable/i);
  assert.equal(pool.state.orders.length, 0);
  assert.equal(pool.state.rolledBack, true);
});

test("oversized request is rejected", async (t) => {
  const client = await withServer(t);
  const body = " ".repeat(32 * 1024 + 1);
  const response = await client.request("POST", "/api/orders", body, jsonHeaders(body));
  assert.equal(response.status, 413);
});

test("oversized chunked request is rejected", async (t) => {
  const client = await withServer(t);
  const body = " ".repeat(32 * 1024 + 1);
  const response = await client.request("POST", "/api/orders", body, {
    "content-type": "application/json"
  });
  assert.equal(response.status, 413);
});

test("database failure rolls back and returns a safe error", async (t) => {
  const pool = createMockPool({ failOn: "item-insert" });
  const client = await withServer(t, pool);
  const response = await postOrder(client, validPayload);

  assert.equal(response.status, 500);
  assert.equal(JSON.parse(response.body).message, "Unable to place the order right now.");
  assert.equal(pool.state.rolledBack, true);
  assert.equal(pool.state.released, true);
  assert.equal(pool.state.destroyed, false);
  assert.equal(pool.state.orders.length, 0);
  assert.equal(pool.state.orderItems.length, 0);
  assert.equal(pool.state.variantStock.get("meera-floral-kurti\u0000M"), 2);
  assert.equal(pool.state.stock.get("meera-floral-kurti").stock_quantity, 5);
});

test("stock update failure rolls back order and size inventory", async (t) => {
  const pool = createMockPool({ failOn: "variant-update" });
  const client = await withServer(t, pool);
  const response = await postOrder(client, validPayload);

  assert.equal(response.status, 500);
  assert.equal(pool.state.rolledBack, true);
  assert.equal(pool.state.orders.length, 0);
  assert.equal(pool.state.orderItems.length, 0);
  assert.equal(pool.state.variantStock.get("meera-floral-kurti\u0000M"), 2);
  assert.equal(pool.state.stock.get("meera-floral-kurti").stock_quantity, 5);
});

test("health endpoints continue to work", async (t) => {
  const client = await withServer(t);
  const status = await client.request("GET", "/api/status", undefined, {
    origin: "http://127.0.0.1:5500"
  });
  const databaseStatus = await client.request("GET", "/api/db-status", undefined, {
    origin: "http://127.0.0.1:5500"
  });

  assert.equal(status.status, 200);
  assert.equal(JSON.parse(status.body).status, "ok");
  assert.equal(status.headers?.["access-control-allow-origin"], "http://127.0.0.1:5500");
  assert.equal(databaseStatus.status, 200);
  assert.equal(JSON.parse(databaseStatus.body).status, "ok");
});

test("unknown routes return 404 and unsupported methods return 405", async (t) => {
  const client = await withServer(t);
  const notFound = await client.request("GET", "/api/unknown");
  const methodNotAllowed = await client.request("PUT", "/api/status");

  assert.equal(notFound.status, 404);
  assert.equal(methodNotAllowed.status, 405);
});

test("availability returns supported sizes and quantities for an active product", async (t) => {
  const client = await withServer(t);
  const response = await getAvailability(client, "meera-floral-kurti");
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    productId: "meera-floral-kurti",
    sizes: [
      { size: "XS", availableQuantity: 0 },
      { size: "S", availableQuantity: 1 },
      { size: "M", availableQuantity: 2 },
      { size: "L", availableQuantity: 1 }
    ]
  });
  assert.deepEqual(client.pool.state.availabilityQueries.map((query) => query.parameters), [
    ["meera-floral-kurti"],
    ["meera-floral-kurti"]
  ]);
  assert.ok(client.pool.state.availabilityQueries.every((query) => query.sql.includes("?")));
});

test("availability includes zero-stock sizes", async (t) => {
  const client = await withServer(t);
  const response = await getAvailability(client, "meera-floral-kurti");
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(body.sizes[0], { size: "XS", availableQuantity: 0 });
});

test("saree availability returns exactly Free Size", async (t) => {
  const client = await withServer(t);
  const response = await getAvailability(client, "madhuri-woven-saree");
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.deepEqual(body.sizes, [{ size: "Free Size", availableQuantity: 8 }]);
});

test("availability returns 404 for an unknown product", async (t) => {
  const client = await withServer(t);
  const response = await getAvailability(client, "unknown-product");

  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), {
    success: false,
    message: "The requested product was not found or is unavailable."
  });
  assert.equal(client.pool.state.availabilityQueries.length, 1);
});

test("availability returns 404 for an inactive product", async (t) => {
  const client = await withServer(t, createMockPool({
    availabilityProducts: {
      "inactive-product": { product_id: "inactive-product", is_active: 0 }
    }
  }));
  const response = await getAvailability(client, "inactive-product");

  assert.equal(response.status, 404);
  assert.equal(client.pool.state.availabilityQueries.length, 1);
});

test("availability database errors return a safe 500 response", async (t) => {
  const client = await withServer(t, createMockPool({ failAvailabilityDatabase: true }));
  const response = await getAvailability(client, "meera-floral-kurti");

  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.body), {
    success: false,
    message: "Unable to retrieve product availability right now."
  });
  assert.equal(response.body.includes("private database detail"), false);
});

test("availability rejects an invalid product ID", async (t) => {
  const client = await withServer(t);
  const response = await getAvailability(client, "Invalid_product");

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(response.body), {
    success: false,
    message: "A product ID is invalid."
  });
  assert.equal(client.pool.state.availabilityQueries.length, 0);
});

test("tracking returns the verified order and item snapshots only", async (t) => {
  const client = await withServer(t);
  const response = await postTrack(client, {
    orderNumber: "DB-0123456789abcdef01234567",
    phone: "9999999999"
  });
  const body = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(Object.keys(body), ["success", "order"]);
  assert.deepEqual(body.order, {
    orderNumber: "DB-0123456789abcdef01234567",
    orderDate: "2026-11-12T10:00:00.000Z",
    totalAmount: 1499,
    paymentMethod: "COD",
    paymentStatus: "Pending",
    orderStatus: "Order Placed",
    items: [{ productName: "Meera Floral Kurti", size: "M", quantity: 1 }]
  });
  assert.equal(client.pool.state.trackingQueries.length, 2);
  assert.deepEqual(client.pool.state.trackingQueries[0].parameters, ["DB-0123456789abcdef01234567"]);
  assert.deepEqual(client.pool.state.trackingQueries[1].parameters, [7]);
  assert.equal(response.body.includes("Private Customer"), false);
  assert.equal(response.body.includes("private@example.com"), false);
  assert.equal(response.body.includes("Private Address"), false);
  assert.equal(response.body.includes("9999999999"), false);
  assert.equal(response.body.includes("private-key"), false);
  assert.equal(response.body.includes("private-fingerprint"), false);
});

test("tracking normalizes country code, spaces and hyphens", async (t) => {
  const client = await withServer(t);
  const response = await postTrack(client, {
    orderNumber: "DB-0123456789abcdef01234567",
    phone: "+91 99999-99999"
  });
  assert.equal(response.status, 200);
});

test("wrong and unknown tracking credentials return the same generic response", async (t) => {
  const client = await withServer(t);
  const wrongPhone = await postTrack(client, {
    orderNumber: "DB-0123456789abcdef01234567",
    phone: "8888888888"
  });
  const unknownOrder = await postTrack(client, {
    orderNumber: "DB-abcdef0123456789abcdef01",
    phone: "9999999999"
  });

  assert.equal(wrongPhone.status, 404);
  assert.equal(unknownOrder.status, wrongPhone.status);
  assert.equal(unknownOrder.body, wrongPhone.body);
  assert.equal(JSON.parse(wrongPhone.body).message, "The order number or phone number could not be verified.");
});

test("tracking rejects malformed JSON and missing or invalid fields", async (t) => {
  const client = await withServer(t);
  const malformed = await client.request("POST", "/api/orders/track", "{", {
    "content-type": "application/json",
    origin: "http://127.0.0.1:5500"
  });
  const missing = await postTrack(client, {});
  const invalidPhone = await postTrack(client, {
    orderNumber: "DB-0123456789abcdef01234567",
    phone: "123"
  });

  assert.equal(malformed.status, 400);
  assert.equal(missing.status, 400);
  assert.equal(invalidPhone.status, 400);
  assert.equal(client.pool.state.trackingQueries.length, 0);
});

test("tracking database errors return a safe error", async (t) => {
  const pool = createMockPool({ failTrackingDatabase: true });
  const client = await withServer(t, pool);
  const response = await postTrack(client, {
    orderNumber: "DB-0123456789abcdef01234567",
    phone: "9999999999"
  });

  assert.equal(response.status, 500);
  assert.equal(JSON.parse(response.body).message, "Unable to retrieve this order right now.");
  assert.equal(response.body.includes("private database detail"), false);
});

test("tracking supports all defined order statuses", async (t) => {
  const client = await withServer(t);
  const statuses = [
    "Order Placed",
    "Confirmed",
    "Processing",
    "Ready for Dispatch",
    "Shipped",
    "Delivered",
    "Cancelled"
  ];

  for (const status of statuses) {
    client.pool.state.trackingOrders[0].order_status = status;
    const response = await postTrack(client, {
      orderNumber: "DB-0123456789abcdef01234567",
      phone: "9999999999"
    });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).order.orderStatus, status);
  }
});

test("tracking rate limits repeated attempts from the same address", async (t) => {
  const pool = createMockPool();
  const client = await withServer(t, pool, async () => true, {
    trackingLimit: 2,
    trackingWindowMs: 60_000
  });
  const invalidAttempt = {
    orderNumber: "DB-abcdef0123456789abcdef01",
    phone: "9999999999"
  };
  await postTrack(client, invalidAttempt);
  await postTrack(client, invalidAttempt);
  const limited = await postTrack(client, invalidAttempt);

  assert.equal(limited.status, 429);
  assert.equal(pool.state.trackingQueries.length, 2);
});

test("database health failure does not expose internal details", async (t) => {
  const client = await withServer(t, createMockPool(), async () => {
    throw new Error("private database detail");
  });
  const response = await client.request("GET", "/api/db-status");

  assert.equal(response.status, 503);
  assert.equal(response.body.includes("private database detail"), false);
});

test("allowed origin receives CORS headers on API responses and errors", async (t) => {
  const client = await withServer(t);
  const body = JSON.stringify(validPayload);
  const response = await client.request("POST", "/api/orders", body, {
    ...jsonHeaders(body),
    "idempotency-key": "invalid-key"
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers["access-control-allow-origin"], "http://127.0.0.1:5500");
  assert.equal(response.headers["access-control-allow-methods"], "GET, POST, PATCH, OPTIONS");
  assert.equal(response.headers["access-control-allow-headers"], "Content-Type, Idempotency-Key");
  assert.equal(response.headers["access-control-allow-credentials"], "true");
});

test("disallowed origin is not granted CORS access", async (t) => {
  const client = await withServer(t);
  const response = await client.request("GET", "/api/status", undefined, {
    origin: "https://unapproved.example"
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.headers.vary, "Origin");
});

test("allowed preflight returns the configured methods and request headers", async (t) => {
  const client = await withServer(t);
  const response = await client.request("OPTIONS", "/api/orders", undefined, {
    origin: "http://127.0.0.1:5500",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type, idempotency-key"
  });

  assert.equal(response.status, 204);
  assert.equal(response.body, "");
  assert.equal(response.headers["access-control-allow-origin"], "http://127.0.0.1:5500");
  assert.equal(response.headers["access-control-allow-methods"], "GET, POST, PATCH, OPTIONS");
  assert.equal(response.headers["access-control-allow-headers"], "Content-Type, Idempotency-Key");
  assert.equal(response.headers["access-control-allow-credentials"], "true");

  const trackingPreflight = await client.request("OPTIONS", "/api/orders/track", undefined, {
    origin: "http://127.0.0.1:5500",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type"
  });
  assert.equal(trackingPreflight.status, 204);
  assert.equal(trackingPreflight.headers["access-control-allow-origin"], "http://127.0.0.1:5500");
});

test("orders preflight rejects GET", async (t) => {
  const client = await withServer(t);
  const response = await client.request("OPTIONS", "/api/orders", undefined, {
    origin: "http://127.0.0.1:5500",
    "access-control-request-method": "GET",
    "access-control-request-headers": "content-type, idempotency-key"
  });

  assert.equal(response.status, 403);
  assert.equal(response.headers["access-control-allow-origin"], "http://127.0.0.1:5500");
});

test("disallowed preflight origin and headers are rejected without CORS grant", async (t) => {
  const client = await withServer(t);
  const disallowedOrigin = await client.request("OPTIONS", "/api/orders", undefined, {
    origin: "https://example.com",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type, idempotency-key"
  });
  const disallowedHeader = await client.request("OPTIONS", "/api/orders", undefined, {
    origin: "http://127.0.0.1:5500",
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization"
  });

  assert.equal(disallowedOrigin.status, 403);
  assert.equal(disallowedOrigin.headers["access-control-allow-origin"], undefined);
  assert.equal(disallowedHeader.status, 403);
  assert.equal(disallowedHeader.headers["access-control-allow-origin"], "http://127.0.0.1:5500");
});

test("product-size rows are locked in sorted order and duplicate order numbers are retried", async (t) => {
  const pool = createMockPool({ collisions: 1 });
  const client = await withServer(t, pool);
  const payload = structuredClone(validPayload);
  payload.items = [
    { productId: "madhuri-woven-saree", size: "Free Size", quantity: 1 },
    { productId: "meera-floral-kurti", size: "M", quantity: 1 }
  ];

  const response = await postOrder(client, payload);
  assert.equal(response.status, 201);
  assert.deepEqual(pool.state.variantLockOrder, [
    "madhuri-woven-saree\u0000Free Size",
    "meera-floral-kurti\u0000M",
    "madhuri-woven-saree\u0000Free Size",
    "meera-floral-kurti\u0000M"
  ]);
  assert.equal(pool.state.beginCount, 2);
  assert.equal(pool.state.rollbackCount, 1);
  assert.equal(pool.state.orderNumberDuplicateCount, 1);
  assert.equal(pool.state.idempotencyDuplicateCount, 0);
  assert.equal(pool.state.released, true);
  assert.equal(pool.state.destroyed, false);
});

test("Free Size order deducts only the saree Free Size variant", async (t) => {
  const client = await withServer(t);
  const payload = structuredClone(validPayload);
  payload.items = [{ productId: "madhuri-woven-saree", size: "Free Size", quantity: 2 }];

  const response = await postOrder(client, payload);
  assert.equal(response.status, 201);
  assert.equal(client.pool.state.variantStock.get("madhuri-woven-saree\u0000Free Size"), 6);
  assert.equal(client.pool.state.stock.get("madhuri-woven-saree").stock_quantity, 8);
  assert.equal(client.pool.state.orderItems[0][4], "Free Size");
});

test("simultaneous orders competing for the last size unit cannot oversell", async (t) => {
  const pool = createMockPool({ sizeStocks: { "meera-floral-kurti\u0000M": 1 } });
  const client = await withServer(t, pool);
  const firstKey = "123e4567-e89b-12d3-a456-426614174011";
  const secondKey = "123e4567-e89b-12d3-a456-426614174012";

  const responses = await Promise.all([
    postOrder(client, validPayload, firstKey),
    postOrder(client, validPayload, secondKey)
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(pool.state.variantStock.get("meera-floral-kurti\u0000M"), 0);
  assert.equal(pool.state.stock.get("meera-floral-kurti").stock_quantity, 5);
  assert.equal(pool.state.orders.length, 1);
  assert.equal(pool.state.orderItems.length, 1);
});

test("duplicate order number retries after successful rollback", async (t) => {
  const pool = createMockPool({ collisions: 1 });
  const client = await withServer(t, pool);
  const response = await postOrder(client, validPayload);

  assert.equal(response.status, 201);
  assert.equal(pool.state.beginCount, 2);
  assert.equal(pool.state.rollbackCount, 1);
  assert.equal(pool.state.committed, true);
  assert.equal(pool.state.orderNumberDuplicateCount, 1);
  assert.equal(pool.state.idempotencyDuplicateCount, 0);
  assert.equal(pool.state.released, true);
  assert.equal(pool.state.destroyed, false);
});

test("failed rollback destroys the connection and prevents collision retry", async (t) => {
  const pool = createMockPool({ collisions: 1, failRollback: true });
  const client = await withServer(t, pool);
  const response = await postOrder(client, validPayload);

  assert.equal(response.status, 500);
  assert.equal(pool.state.beginCount, 1);
  assert.equal(pool.state.rollbackCount, 1);
  assert.equal(pool.state.released, false);
  assert.equal(pool.state.destroyed, true);
});

test("same key and same payload returns original order without decrementing stock twice", async (t) => {
  const client = await withServer(t);
  const key = "123e4567-e89b-12d3-a456-426614174001";
  const first = await postOrder(client, validPayload, key);
  const stockAfterFirst = client.pool.state.variantStock.get("meera-floral-kurti\u0000M");
  const replay = await postOrder(client, validPayload, key);

  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(JSON.parse(replay.body).orderNumber, JSON.parse(first.body).orderNumber);
  assert.equal(JSON.parse(replay.body).totalAmount, 1499);
  assert.equal(client.pool.state.orders.length, 1);
  assert.equal(client.pool.state.orderItems.length, 1);
  assert.equal(client.pool.state.idempotencyRecords.size, 1);
  assert.equal(client.pool.state.variantStock.get("meera-floral-kurti\u0000M"), stockAfterFirst);
  assert.equal(client.pool.state.orders[0].idempotency_key, key);
  assert.equal(stockAfterFirst, 1);
  assert.equal(client.pool.state.stock.get("meera-floral-kurti").stock_quantity, 5);
});

test("same key with a changed payload returns conflict without exposing personal details", async (t) => {
  const client = await withServer(t);
  const key = "123e4567-e89b-12d3-a456-426614174002";
  await postOrder(client, validPayload, key);
  const changedPayload = structuredClone(validPayload);
  changedPayload.customer.name = "Different Customer";
  const response = await postOrder(client, changedPayload, key);

  assert.equal(response.status, 409);
  assert.equal(response.body.includes("Test Customer"), false);
  assert.equal(response.body.includes("Different Customer"), false);
  assert.equal(client.pool.state.orders.length, 1);
});

test("simultaneous requests with the same key create only one order", async (t) => {
  const pool = createMockPool({ sizeStocks: { "meera-floral-kurti\u0000M": 1 } });
  const client = await withServer(t, pool);
  const key = "123e4567-e89b-12d3-a456-426614174003";
  const responses = await Promise.all([
    postOrder(client, validPayload, key),
    postOrder(client, validPayload, key)
  ]);
  const bodies = responses.map((response) => JSON.parse(response.body));

  assert.deepEqual(responses.map((response) => response.status), [201, 201]);
  assert.equal(bodies[0].orderNumber, bodies[1].orderNumber);
  assert.equal(client.pool.state.orders.length, 1);
  assert.equal(client.pool.state.orderItems.length, 1);
  assert.equal(client.pool.state.idempotencyRecords.size, 1);
  assert.equal(client.pool.state.variantStock.get("meera-floral-kurti\u0000M"), 0);
});

test("duplicate idempotency key is distinguished from order number collision", async (t) => {
  const pool = createMockPool({ idempotencyCollision: true });
  const client = await withServer(t, pool);
  const response = await postOrder(client, validPayload);

  assert.equal(response.status, 201);
  assert.equal(pool.state.beginCount, 1);
  assert.equal(pool.state.rollbackCount, 1);
  assert.equal(pool.state.idempotencyDuplicateCount, 1);
  assert.equal(pool.state.orderNumberDuplicateCount, 0);
  assert.equal(pool.state.orders.length, 1);
});

test("retry after a lost response returns the committed order", async (t) => {
  const client = await withServer(t);
  const key = "123e4567-e89b-12d3-a456-426614174004";
  const first = await postOrder(client, validPayload, key);
  const retry = await postOrder(client, validPayload, key);

  assert.equal(JSON.parse(retry.body).orderNumber, JSON.parse(first.body).orderNumber);
  assert.equal(client.pool.state.orders.length, 1);
});

test("different idempotency keys create separate orders", async (t) => {
  const client = await withServer(t);
  const first = await postOrder(client, validPayload, "123e4567-e89b-12d3-a456-426614174005");
  const second = await postOrder(client, validPayload, "123e4567-e89b-12d3-a456-426614174006");

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(JSON.parse(first.body).orderNumber, JSON.parse(second.body).orderNumber);
  assert.equal(client.pool.state.orders.length, 2);
  assert.equal(client.pool.state.idempotencyRecords.size, 2);
});

test("failed order transaction leaves no idempotency reservation", async (t) => {
  const pool = createMockPool({ failOn: "item-insert" });
  const client = await withServer(t, pool);
  const response = await postOrder(
    client,
    validPayload,
    "123e4567-e89b-12d3-a456-426614174007"
  );

  assert.equal(response.status, 500);
  assert.equal(pool.state.idempotencyRecords.size, 0);
  assert.equal(pool.state.orders.length, 0);
  assert.equal(pool.state.released, true);
});

test("equivalent item ordering and duplicate lines share a fingerprint", async (t) => {
  const client = await withServer(t);
  const key = "123e4567-e89b-12d3-a456-426614174008";
  const firstPayload = structuredClone(validPayload);
  firstPayload.items = [
    { productId: "meera-floral-kurti", size: "M", quantity: 1 },
    { productId: "meera-floral-kurti", size: "M", quantity: 1 }
  ];
  const equivalentPayload = structuredClone(validPayload);
  equivalentPayload.items[0].quantity = 2;

  const first = await postOrder(client, firstPayload, key);
  const replay = await postOrder(client, equivalentPayload, key);

  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(JSON.parse(first.body).orderNumber, JSON.parse(replay.body).orderNumber);
  assert.equal(client.pool.state.orders.length, 1);
  assert.equal(client.pool.state.orderItems.length, 1);
  assert.equal(client.pool.state.orderItems[0][5], 2);
});
