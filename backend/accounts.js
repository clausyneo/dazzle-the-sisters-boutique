const {
  createHash,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual
} = require("node:crypto");
const { promisify } = require("node:util");
const { RequestError } = require("./orders");

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE_NAME = "dazzle_session";
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_MS / 1000;
const PASSWORD_BYTES = 64;
const DUMMY_SALT = Buffer.alloc(16, 0x5a);
const DUMMY_HASH = Buffer.alloc(PASSWORD_BYTES, 0x5a);
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

function requireText(value, label, maximumLength) {
  if (typeof value !== "string") {
    throw new RequestError(400, `${label} is required.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximumLength) {
    throw new RequestError(400, `${label} is required and must be at most ${maximumLength} characters.`);
  }
  return trimmed;
}

function normalizePhone(phone) {
  return phone.replace(/[\s-]/g, "").replace(/^\+91/, "");
}

function isValidIndianPhone(phone) {
  return /^\+?[\d\s-]+$/.test(phone) &&
    /^[6-9]\d{9}$/.test(normalizePhone(phone));
}

function normalizeEmail(value) {
  const email = requireText(value, "Email", 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new RequestError(400, "Enter a valid email address.");
  }
  return email;
}

function validatePassword(value, isRegistration) {
  if (typeof value !== "string" ||
      value.length > (isRegistration ? 16 : 128) ||
      (isRegistration ? value.length < 7 : value.length < 1)) {
    throw new RequestError(
      400,
      isRegistration
        ? "Password must be between 7 and 16 characters."
        : "Enter your password."
    );
  }
  return value;
}

function validateRegistration(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }
  const name = requireText(body.name, "Name", 150);
  const phoneInput = requireText(body.phone, "Phone number", 20);
  if (!isValidIndianPhone(phoneInput)) {
    throw new RequestError(400, "Enter a valid Indian mobile number.");
  }
  return {
    name,
    phone: normalizePhone(phoneInput),
    email: normalizeEmail(body.email),
    password: validatePassword(body.password, true)
  };
}

function validateLogin(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }
  const identifier = requireText(body.identifier, "Email or phone number", 254);
  let normalizedIdentifier;
  let column;
  if (identifier.includes("@")) {
    normalizedIdentifier = normalizeEmail(identifier);
    column = "email";
  } else {
    if (!isValidIndianPhone(identifier)) {
      throw new RequestError(400, "Enter a valid email or Indian mobile number.");
    }
    normalizedIdentifier = normalizePhone(identifier);
    column = "phone";
  }
  return {
    identifier: normalizedIdentifier,
    column,
    password: validatePassword(body.password, false)
  };
}

function safeCustomer(row) {
  return {
    customerId: Number(row.customer_id),
    name: row.name,
    phone: row.phone,
    email: row.email
  };
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function validatePasswordResetRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }
  return normalizeEmail(body.email);
}

function validatePasswordReset(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }
  if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
    throw new RequestError(400, "This reset link is invalid or has expired.");
  }
  return {
    tokenHash: hashSessionToken(body.token),
    password: validatePassword(body.password, true)
  };
}

function parseSessionToken(request) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!cookie) return null;
  const token = cookie.slice(SESSION_COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function sessionCookie(token, isProduction = process.env.NODE_ENV === "production") {
  const security = isProduction ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_LIFETIME_SECONDS}${security}`;
}

function clearSessionCookie(isProduction = process.env.NODE_ENV === "production") {
  const security = isProduction ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${security}`;
}

async function createSession(executor, customerId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  await executor.execute(
    `INSERT INTO customer_sessions (customer_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [customerId, tokenHash, expiresAt]
  );
  return token;
}

async function registerCustomer(pool, body) {
  const customer = validateRegistration(body);
  const salt = randomBytes(16);
  const passwordHash = await scrypt(customer.password, salt, PASSWORD_BYTES);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO customers (name, phone, email, password_salt, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [customer.name, customer.phone, customer.email, salt.toString("hex"), passwordHash.toString("hex")]
    );
    const customerId = Number(result.insertId);
    const token = await createSession(connection, customerId);
    await connection.commit();
    return {
      customer: { customerId, name: customer.name, phone: customer.phone, email: customer.email },
      token
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Account registration rollback failed:", rollbackError.code || "database error");
    }
    if (error.code === "ER_DUP_ENTRY") {
      throw new RequestError(409, "An account with these contact details already exists.");
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function loginCustomer(pool, body) {
  const login = validateLogin(body);
  const [rows] = await pool.execute(
    `SELECT customer_id, name, phone, email, password_salt, password_hash
     FROM customers
     WHERE ${login.column} = ?
     LIMIT 1`,
    [login.identifier]
  );
  const customer = rows[0];
  const salt = customer ? Buffer.from(customer.password_salt, "hex") : DUMMY_SALT;
  const storedHash = customer ? Buffer.from(customer.password_hash, "hex") : DUMMY_HASH;
  const submittedHash = await scrypt(login.password, salt, PASSWORD_BYTES);
  if (!customer ||
      storedHash.length !== submittedHash.length ||
      !timingSafeEqual(storedHash, submittedHash)) {
    throw new RequestError(401, "The email/phone or password is incorrect.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const token = await createSession(connection, customer.customer_id);
    await connection.commit();
    return { customer: safeCustomer(customer), token };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Account login rollback failed:", rollbackError.code || "database error");
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function requestCustomerPasswordReset(pool, body, sendEmail, emailConfigured) {
  const email = validatePasswordResetRequest(body);
  if (!emailConfigured) {
    throw new RequestError(503, "Password recovery email is not configured. Please try again later.");
  }

  const genericResponse = {
    success: true,
    message: "If an account exists for that email, reset instructions will be sent if email delivery is available."
  };
  const [customers] = await pool.execute(
    `SELECT customer_id, name, email
     FROM customers
     WHERE email = ?
     LIMIT 1`,
    [email]
  );
  const customer = customers[0];
  if (!customer) return genericResponse;

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const connection = await pool.getConnection();
  let resetId;
  try {
    await connection.beginTransaction();
    await connection.execute(
      `SELECT customer_id
       FROM customers
       WHERE customer_id = ?
       FOR UPDATE`,
      [customer.customer_id]
    );
    await connection.execute(
      `UPDATE customer_password_resets
       SET used_at = UTC_TIMESTAMP()
       WHERE customer_id = ? AND used_at IS NULL`,
      [customer.customer_id]
    );
    const [result] = await connection.execute(
      `INSERT INTO customer_password_resets (customer_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [customer.customer_id, tokenHash, expiresAt]
    );
    resetId = Number(result.insertId);
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Password reset request rollback failed:", rollbackError.code || "database error");
    }
    throw error;
  } finally {
    connection.release();
  }

  try {
    await sendEmail({
      email: customer.email,
      token
    });
  } catch (error) {
    try {
      await pool.execute(
        `UPDATE customer_password_resets
         SET used_at = UTC_TIMESTAMP()
         WHERE reset_id = ? AND used_at IS NULL`,
        [resetId]
      );
    } catch (cleanupError) {
      console.error("Password reset token cleanup failed:", cleanupError.code || "database error");
    }
    console.error("Password reset email delivery failed:", error.code || "email error");
  }
  return genericResponse;
}

async function resetCustomerPassword(pool, body) {
  const reset = validatePasswordReset(body);
  const salt = randomBytes(16);
  const passwordHash = await scrypt(reset.password, salt, PASSWORD_BYTES);
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.execute(
      `SELECT reset_id, customer_id
       FROM customer_password_resets
       WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP() AND used_at IS NULL
       FOR UPDATE`,
      [reset.tokenHash]
    );
    const resetToken = rows[0];
    if (!resetToken) {
      throw new RequestError(400, "This reset link is invalid or has expired.");
    }
    const [activeTokens] = await connection.execute(
      `SELECT reset_id
       FROM customer_password_resets
       WHERE reset_id = ? AND expires_at > UTC_TIMESTAMP() AND used_at IS NULL
       FOR UPDATE`,
      [resetToken.reset_id]
    );
    if (!activeTokens[0]) {
      throw new RequestError(400, "This reset link is invalid or has expired.");
    }
    const [updateResult] = await connection.execute(
      `UPDATE customers
       SET password_salt = ?, password_hash = ?
       WHERE customer_id = ?`,
      [salt.toString("hex"), passwordHash.toString("hex"), resetToken.customer_id]
    );
    if (updateResult.affectedRows !== 1) {
      throw new Error("The password reset customer no longer exists.");
    }
    await connection.execute(
      `UPDATE customer_password_resets
       SET used_at = UTC_TIMESTAMP()
       WHERE customer_id = ? AND used_at IS NULL`,
      [resetToken.customer_id]
    );
    await connection.execute(
      "DELETE FROM customer_sessions WHERE customer_id = ?",
      [resetToken.customer_id]
    );
    await connection.commit();
    transactionStarted = false;
    return { success: true, message: "Your password has been updated. Please sign in again." };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Password reset rollback failed:", rollbackError.code || "database error");
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function getAuthenticatedCustomer(pool, request) {
  const token = parseSessionToken(request);
  if (!token) return null;
  const [rows] = await pool.execute(
    `SELECT c.customer_id, c.name, c.phone, c.email
     FROM customer_sessions s
     JOIN customers c ON c.customer_id = s.customer_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [hashSessionToken(token)]
  );
  return rows[0] ? safeCustomer(rows[0]) : null;
}

async function logoutCustomer(pool, request) {
  const token = parseSessionToken(request);
  if (!token) return;
  await pool.execute(
    "DELETE FROM customer_sessions WHERE token_hash = ?",
    [hashSessionToken(token)]
  );
}

async function updateCustomerProfile(pool, customerId, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }
  const name = requireText(body.name, "Name", 150);
  const phoneInput = requireText(body.phone, "Phone number", 20);
  if (!isValidIndianPhone(phoneInput)) {
    throw new RequestError(400, "Enter a valid Indian mobile number.");
  }
  const phone = normalizePhone(phoneInput);
  const email = normalizeEmail(body.email);
  try {
    await pool.execute(
      `UPDATE customers SET name = ?, phone = ?, email = ?
       WHERE customer_id = ?`,
      [name, phone, email, customerId]
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new RequestError(409, "Another account already uses that email or phone number.");
    }
    throw error;
  }
  return { customerId, name, phone, email };
}

async function listCustomerOrders(pool, customerId) {
  const [rows] = await pool.execute(
    `SELECT order_id, order_number, created_at, total_amount,
            payment_method, payment_status, order_status
     FROM orders
     WHERE customer_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
    [customerId]
  );
  return rows.map((row) => ({
    orderId: Number(row.order_id),
    orderNumber: row.order_number,
    orderDate: new Date(row.created_at).toISOString(),
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    orderStatus: row.order_status
  }));
}

async function getCustomerOrder(pool, customerId, rawOrderId) {
  const orderId = Number(rawOrderId);
  if (!/^\d+$/.test(String(rawOrderId)) || !Number.isSafeInteger(orderId) || orderId < 1) {
    throw new RequestError(400, "An order ID is invalid.");
  }
  const [orders] = await pool.execute(
    `SELECT order_id, order_number, created_at, total_amount,
            payment_method, payment_status, order_status
     FROM orders
     WHERE order_id = ? AND customer_id = ?
     LIMIT 1`,
    [orderId, customerId]
  );
  if (!orders[0]) {
    throw new RequestError(404, "The requested order was not found.");
  }
  const [items] = await pool.execute(
    `SELECT product_name_snapshot, selected_size, quantity
     FROM order_items
     WHERE order_id = ?
     ORDER BY order_item_id`,
    [orderId]
  );
  const order = orders[0];
  return {
    orderNumber: order.order_number,
    orderDate: new Date(order.created_at).toISOString(),
    totalAmount: Number(order.total_amount),
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    orderStatus: order.order_status,
    items: items.map((item) => ({
      productName: item.product_name_snapshot,
      size: item.selected_size,
      quantity: Number(item.quantity)
    }))
  };
}

module.exports = {
  SESSION_COOKIE_NAME,
  RequestError,
  clearSessionCookie,
  getAuthenticatedCustomer,
  listCustomerOrders,
  getCustomerOrder,
  loginCustomer,
  logoutCustomer,
  registerCustomer,
  requestCustomerPasswordReset,
  resetCustomerPassword,
  sessionCookie,
  updateCustomerProfile
};
