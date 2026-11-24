const {
  createHash,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual
} = require("node:crypto");
const { promisify } = require("node:util");
const { RequestError } = require("./orders");

const scrypt = promisify(scryptCallback);
const ADMIN_COOKIE_NAME = "dazzle_admin_session";
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_MS / 1000;
const PASSWORD_BYTES = 64;
const DUMMY_SALT = Buffer.alloc(16, 0x6b);
const DUMMY_HASH = Buffer.alloc(PASSWORD_BYTES, 0x6b);
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const ORDER_STATUSES = [
  "Order Placed",
  "Confirmed",
  "Processing",
  "Ready for Dispatch",
  "Shipped",
  "Delivered",
  "Cancelled"
];
const NEXT_ORDER_STATUS = new Map([
  ["Order Placed", "Confirmed"],
  ["Confirmed", "Processing"],
  ["Processing", "Ready for Dispatch"],
  ["Ready for Dispatch", "Shipped"],
  ["Shipped", "Delivered"]
]);
const CANCELLABLE_ORDER_STATUSES = new Set([
  "Order Placed",
  "Confirmed",
  "Processing",
  "Ready for Dispatch"
]);

function validateUsername(value) {
  if (typeof value !== "string") {
    throw new RequestError(400, "A username or email address is required.");
  }
  const username = value.trim().toLowerCase();
  if (username.length > 254) {
    throw new RequestError(400, "The username or email address is too long.");
  }
  if (username.includes("@")) {
    if (!EMAIL_PATTERN.test(username)) {
      throw new RequestError(400, "Enter a valid email address.");
    }
  } else if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw new RequestError(400, "Use 3 to 64 letters, numbers, dots, underscores or hyphens.");
  }
  return username;
}

function validatePassword(value, isCreation) {
  if (typeof value !== "string" ||
      value.length > (isCreation ? 16 : 128) ||
      (isCreation ? value.length < 7 : value.length < 1)) {
    throw new RequestError(
      400,
      isCreation
        ? "Password must be between 7 and 16 characters."
        : "Enter your password."
    );
  }
  return value;
}

function safeAdmin(row) {
  return { adminId: Number(row.admin_id), username: row.username };
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function parseAdminToken(request) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_COOKIE_NAME}=`));
  if (!cookie) return null;
  const token = cookie.slice(ADMIN_COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function adminSessionCookie(token, isProduction = process.env.NODE_ENV === "production") {
  const security = isProduction ? "; Secure" : "";
  const sameSite = isProduction ? "None" : "Strict";
  return `${ADMIN_COOKIE_NAME}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${SESSION_LIFETIME_SECONDS}${security}`;
}

function clearAdminSessionCookie(isProduction = process.env.NODE_ENV === "production") {
  const security = isProduction ? "; Secure" : "";
  const sameSite = isProduction ? "None" : "Strict";
  return `${ADMIN_COOKIE_NAME}=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0${security}`;
}

async function createAdminSession(executor, adminId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  await executor.execute(
    `INSERT INTO admin_sessions (admin_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [adminId, tokenHash, expiresAt]
  );
  return token;
}

async function createAdminAccount(pool, rawUsername, rawPassword) {
  const username = validateUsername(rawUsername);
  const password = validatePassword(rawPassword, true);
  const [existingAdmins] = await pool.execute(
    "SELECT admin_id FROM admin_users LIMIT 1"
  );
  if (existingAdmins.length > 0) {
    throw new RequestError(409, "First-admin setup is already complete.");
  }
  const salt = randomBytes(16);
  const passwordHash = await scrypt(password, salt, PASSWORD_BYTES);
  try {
    const [result] = await pool.execute(
      `INSERT INTO admin_users (username, password_salt, password_hash)
       VALUES (?, ?, ?)`,
      [username, salt.toString("hex"), passwordHash.toString("hex")]
    );
    return { adminId: Number(result.insertId), username };
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new RequestError(409, "An admin account already uses that username or email.");
    }
    throw error;
  }
}

async function resetAdminPassword(pool, rawUsername, rawPassword) {
  const username = validateUsername(rawUsername);
  const password = validatePassword(rawPassword, true);
  const salt = randomBytes(16);
  const passwordHash = await scrypt(password, salt, PASSWORD_BYTES);
  const [result] = await pool.execute(
    `UPDATE admin_users
     SET password_salt = ?, password_hash = ?
     WHERE username = ?`,
    [salt.toString("hex"), passwordHash.toString("hex"), username]
  );
  if (result.affectedRows !== 1) {
    throw new RequestError(404, "No admin account was found with that username.");
  }
  return { username };
}

async function loginAdmin(pool, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }
  const username = validateUsername(body.username);
  const password = validatePassword(body.password, false);
  const [rows] = await pool.execute(
    `SELECT admin_id, username, password_salt, password_hash
     FROM admin_users
     WHERE username = ? AND is_active = 1
     LIMIT 1`,
    [username]
  );
  const admin = rows[0];
  const salt = admin ? Buffer.from(admin.password_salt, "hex") : DUMMY_SALT;
  const storedHash = admin ? Buffer.from(admin.password_hash, "hex") : DUMMY_HASH;
  const submittedHash = await scrypt(password, salt, PASSWORD_BYTES);
  if (!admin ||
      storedHash.length !== submittedHash.length ||
      !timingSafeEqual(storedHash, submittedHash)) {
    throw new RequestError(401, "The username/email or password is incorrect.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const token = await createAdminSession(connection, admin.admin_id);
    await connection.commit();
    return { admin: safeAdmin(admin), token };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Admin login rollback failed:", rollbackError.code || "database error");
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function getAuthenticatedAdmin(pool, request) {
  const token = parseAdminToken(request);
  if (!token) return null;
  const [rows] = await pool.execute(
    `SELECT a.admin_id, a.username
     FROM admin_sessions s
     JOIN admin_users a ON a.admin_id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND a.is_active = 1
     LIMIT 1`,
    [hashSessionToken(token)]
  );
  return rows[0] ? safeAdmin(rows[0]) : null;
}

async function logoutAdmin(pool, request) {
  const token = parseAdminToken(request);
  if (!token) return;
  await pool.execute(
    "DELETE FROM admin_sessions WHERE token_hash = ?",
    [hashSessionToken(token)]
  );
}

function validatePage(value) {
  if (value === null || value === undefined || value === "") return 1;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) {
    throw new RequestError(400, "Page must be a positive whole number.");
  }
  return page;
}

function validatePageSize(value) {
  if (value === null || value === undefined || value === "") return 20;
  const pageSize = Number(value);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new RequestError(400, "Page size must be between 1 and 50.");
  }
  return pageSize;
}

function validateDate(value, label) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestError(400, `${label} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RequestError(400, `${label} is not a valid date.`);
  }
  return value;
}

function buildOrderFilters(parameters) {
  const clauses = [];
  const values = [];
  const search = parameters.get("search") || "";
  if (search.length > 32) {
    throw new RequestError(400, "Order-number search must be at most 32 characters.");
  }
  if (search.trim()) {
    clauses.push("order_number LIKE ?");
    values.push(`%${search.trim()}%`);
  }

  const status = parameters.get("status") || "";
  if (status) {
    if (!ORDER_STATUSES.includes(status)) {
      throw new RequestError(400, "The selected order status is invalid.");
    }
    clauses.push("order_status = ?");
    values.push(status);
  }

  const from = validateDate(parameters.get("from"), "Start date");
  const to = validateDate(parameters.get("to"), "End date");
  if (from && to && from > to) {
    throw new RequestError(400, "Start date must be on or before end date.");
  }
  if (from) {
    clauses.push("created_at >= ?");
    values.push(from);
  }
  if (to) {
    clauses.push("created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    values.push(to);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values
  };
}

async function getDashboardSummary(pool) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total_orders,
            COALESCE(SUM(order_status NOT IN ('Delivered', 'Cancelled')), 0) AS pending_orders,
            COALESCE(SUM(order_status = 'Delivered'), 0) AS completed_orders,
            COALESCE(SUM(CASE WHEN order_status <> 'Cancelled' THEN total_amount ELSE 0 END), 0) AS order_value
     FROM orders`
  );
  const summary = rows[0];
  return {
    totalOrders: Number(summary.total_orders),
    pendingOrders: Number(summary.pending_orders),
    completedOrders: Number(summary.completed_orders),
    orderValue: Number(summary.order_value)
  };
}

async function listAdminOrders(pool, parameters) {
  const page = validatePage(parameters.get("page"));
  const pageSize = validatePageSize(parameters.get("pageSize"));
  const { where, values } = buildOrderFilters(parameters);
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total
     FROM orders
     ${where}`,
    values
  );
  const total = Number(countRows[0].total);
  const offset = (page - 1) * pageSize;
  const [rows] = await pool.execute(
    `SELECT order_id, order_number, customer_name, created_at, total_amount,
            payment_method, payment_status, order_status
     FROM orders
     ${where}
     ORDER BY created_at DESC, order_id DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );
  return {
    orders: rows.map((row) => ({
      orderId: Number(row.order_id),
      orderNumber: row.order_number,
      customerName: row.customer_name,
      orderDate: new Date(row.created_at).toISOString(),
      totalAmount: Number(row.total_amount),
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      orderStatus: row.order_status
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}

function validateOrderId(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) {
    throw new RequestError(400, "An order ID is invalid.");
  }
  return value;
}

async function getAdminOrder(pool, rawOrderId) {
  const orderId = validateOrderId(rawOrderId);
  const [orders] = await pool.execute(
    `SELECT order_id, order_number, customer_name, mobile_number, email,
            delivery_address, city, pin_code, created_at, total_amount,
            payment_method, payment_status, order_status
     FROM orders
     WHERE order_id = ?
     LIMIT 1`,
    [orderId]
  );
  const order = orders[0];
  if (!order) throw new RequestError(404, "The requested order was not found.");

  const [items] = await pool.execute(
    `SELECT product_name_snapshot, selected_size, quantity,
            product_price_snapshot, item_subtotal
     FROM order_items
     WHERE order_id = ?
     ORDER BY order_item_id`,
    [orderId]
  );
  return {
    orderId: Number(order.order_id),
    orderNumber: order.order_number,
    customer: {
      name: order.customer_name,
      phone: order.mobile_number,
      email: order.email,
      address: order.delivery_address,
      city: order.city,
      pinCode: order.pin_code
    },
    orderDate: new Date(order.created_at).toISOString(),
    totalAmount: Number(order.total_amount),
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    orderStatus: order.order_status,
    items: items.map((item) => ({
      productName: item.product_name_snapshot,
      size: item.selected_size,
      quantity: Number(item.quantity),
      unitPrice: Number(item.product_price_snapshot),
      subtotal: Number(item.item_subtotal)
    }))
  };
}

async function updateAdminOrderStatus(pool, rawOrderId, requestedStatus) {
  const orderId = validateOrderId(rawOrderId);
  if (typeof requestedStatus !== "string" || !ORDER_STATUSES.includes(requestedStatus)) {
    throw new RequestError(400, "The requested order status is invalid.");
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.execute(
      `SELECT o.order_status, o.order_number, o.customer_id, o.email,
              o.total_amount, o.payment_method, c.email AS account_email
       FROM orders o
       LEFT JOIN customers c ON c.customer_id = o.customer_id
       WHERE o.order_id = ?
       FOR UPDATE`,
      [orderId]
    );
    if (!rows[0]) throw new RequestError(404, "The requested order was not found.");

    const order = rows[0];
    const currentStatus = order.order_status;
    const changed = requestedStatus !== currentStatus;
    if (requestedStatus !== currentStatus &&
        NEXT_ORDER_STATUS.get(currentStatus) !== requestedStatus &&
        !(requestedStatus === "Cancelled" && CANCELLABLE_ORDER_STATUSES.has(currentStatus))) {
      throw new RequestError(409, "This order cannot move to the requested status.");
    }
    let notification = null;
    if (changed) {
      await connection.execute(
        "UPDATE orders SET order_status = ? WHERE order_id = ?",
        [requestedStatus, orderId]
      );
      const [items] = await connection.execute(
        `SELECT product_name_snapshot, selected_size, quantity, item_subtotal
         FROM order_items
         WHERE order_id = ?
         ORDER BY order_item_id`,
        [orderId]
      );
      const recipient = order.customer_id === null
        ? order.email
        : order.account_email;
      notification = {
        email: typeof recipient === "string" && EMAIL_PATTERN.test(recipient.trim())
          ? recipient.trim()
          : null,
        order: {
          orderNumber: order.order_number,
          previousStatus: currentStatus,
          orderStatus: requestedStatus,
          totalAmount: Number(order.total_amount),
          paymentMethod: order.payment_method,
          items: items.map((item) => ({
            productName: item.product_name_snapshot,
            size: item.selected_size,
            quantity: Number(item.quantity),
            subtotal: Number(item.item_subtotal)
          }))
        }
      };
    }
    await connection.commit();
    transactionStarted = false;
    return {
      orderId: Number(orderId),
      orderStatus: requestedStatus,
      changed,
      notification
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Admin order status rollback failed:", rollbackError.code || "database error");
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function updateAdminOrderPaymentStatus(pool, rawOrderId) {
  const orderId = validateOrderId(rawOrderId);
  const connection = await pool.getConnection();
  let destroyConnection = false;
  let transactionState = "clean";

  try {
    transactionState = "uncertain";
    await connection.beginTransaction();
    transactionState = "active";

    const [rows] = await connection.execute(
      `SELECT order_id, order_number, total_amount, payment_method, payment_status, order_status
       FROM orders
       WHERE order_id = ?
       FOR UPDATE`,
      [orderId]
    );
    if (!rows[0]) {
      throw new RequestError(404, "The requested order was not found.");
    }

    const order = rows[0];
    if (order.payment_method !== "COD") {
      throw new RequestError(409, "This order does not use Cash on Delivery payment.");
    }
    if (order.order_status === "Cancelled") {
      throw new RequestError(409, "Cancelled orders cannot be marked as paid.");
    }
    if (order.payment_status === "Paid") {
      throw new RequestError(409, "This order has already been marked as paid.");
    }
    if (order.payment_status !== "Pending") {
      throw new RequestError(409, "This order payment cannot be updated from its current status.");
    }

    const [updateResult] = await connection.execute(
      `UPDATE orders
       SET payment_status = ?
       WHERE order_id = ? AND payment_status = ?`,
      ["Paid", orderId, "Pending"]
    );
    if (updateResult.affectedRows !== 1) {
      throw new RequestError(409, "This order payment has already been recorded.");
    }

    transactionState = "committing";
    await connection.commit();
    transactionState = "clean";
    return {
      orderId: Number(order.order_id),
      orderNumber: order.order_number,
      paymentStatus: "Paid",
      orderStatus: order.order_status,
      totalAmount: Number(order.total_amount)
    };
  } catch (error) {
    if (transactionState === "active" || transactionState === "uncertain") {
      try {
        await connection.rollback();
        transactionState = "clean";
      } catch (rollbackError) {
        destroyConnection = true;
        console.error("Admin order payment rollback failed:", rollbackError.code || "database error");
      }
    } else if (transactionState === "committing") {
      destroyConnection = true;
    }
    throw error;
  } finally {
    if (destroyConnection) {
      connection.destroy();
    } else {
      connection.release();
    }
  }
}

module.exports = {
  ADMIN_COOKIE_NAME,
  ORDER_STATUSES,
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminAccount,
  getAdminOrder,
  getAuthenticatedAdmin,
  getDashboardSummary,
  listAdminOrders,
  loginAdmin,
  logoutAdmin,
  resetAdminPassword,
  updateAdminOrderPaymentStatus,
  updateAdminOrderStatus
};