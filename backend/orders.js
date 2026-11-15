const { createHash, randomBytes } = require("node:crypto");

const MAX_BODY_BYTES = 32 * 1024;
const MAX_ITEMS = 20;
const MAX_QUANTITY = 99;
const MAX_ORDER_TOTAL_CENTS = 9_999_999_999;
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const STANDARD_SIZES = new Set(["XS", "S", "M", "L", "XL", "XXL"]);
const FREE_SIZE_PRODUCT_IDS = new Set([
  "madhuri-woven-saree",
  "chandni-festive-saree"
]);
const ORDER_NUMBER_ATTEMPTS = 3;

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

class OrderNumberCollision extends Error {}
class IdempotencyKeyCollision extends Error {}

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

function validateOrderPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }

  const customer = payload.customer;
  if (!customer || typeof customer !== "object" || Array.isArray(customer)) {
    throw new RequestError(400, "Customer details are required.");
  }

  const name = requireText(customer.name, "Customer name", 150);
  const phone = requireText(customer.phone, "Mobile number", 20);
  if (!/^(?:\+91[\s-]?)?[6-9]\d{9}$/.test(phone)) {
    throw new RequestError(400, "Enter a valid Indian mobile number.");
  }

  let email = null;
  if (customer.email !== undefined && customer.email !== null && customer.email !== "") {
    email = requireText(customer.email, "Email", 254);
    if (!EMAIL_PATTERN.test(email)) {
      throw new RequestError(400, "Enter a valid email address.");
    }
  }

  const address = requireText(customer.address, "Delivery address", 500);
  const city = requireText(customer.city, "City", 100);
  const pincode = requireText(customer.pincode, "PIN code", 10);
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    throw new RequestError(400, "Enter a valid six-digit Indian PIN code.");
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new RequestError(400, "Add at least one item to the order.");
  }
  if (payload.items.length > MAX_ITEMS) {
    throw new RequestError(400, `An order can contain at most ${MAX_ITEMS} items.`);
  }

  const items = payload.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RequestError(400, "Each cart item must be an object.");
    }

    const productId = requireText(item.productId, "Product ID", 80);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(productId)) {
      throw new RequestError(400, "A product ID is invalid.");
    }

    if (typeof item.size !== "string" ||
        (!STANDARD_SIZES.has(item.size) && item.size !== "Free Size")) {
      throw new RequestError(400, "A selected size is invalid.");
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      throw new RequestError(400, `Each quantity must be a positive whole number no greater than ${MAX_QUANTITY}.`);
    }

    return { productId, size: item.size, quantity: item.quantity };
  });

  return {
    customer: { name, phone, email, address, city, pincode },
    items
  };
}

function validateIdempotencyKey(value) {
  const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const opaqueKeyPattern = /^[A-Za-z0-9_-]{32,64}$/;
  if (typeof value !== "string" || value.length > 64 ||
      (!uuidPattern.test(value) && !opaqueKeyPattern.test(value))) {
    throw new RequestError(400, "A valid Idempotency-Key header is required.");
  }
  return uuidPattern.test(value) ? value.toLowerCase() : value;
}

function normalizeItems(items) {
  const quantities = new Map();
  for (const item of items) {
    const key = `${item.productId}\u0000${item.size}`;
    quantities.set(key, (quantities.get(key) || 0) + item.quantity);
  }
  return [...quantities.entries()]
    .map(([key, quantity]) => {
      const separator = key.indexOf("\u0000");
      return {
        productId: key.slice(0, separator),
        size: key.slice(separator + 1),
        quantity
      };
    })
    .sort((left, right) =>
      (left.productId < right.productId ? -1 : left.productId > right.productId ? 1 : 0) ||
      (left.size < right.size ? -1 : left.size > right.size ? 1 : 0)
    );
}

function createRequestFingerprint(customer, items) {
  const normalizedItems = normalizeItems(items);
  const normalizedCustomer = {
    ...customer,
    phone: normalizePhone(customer.phone),
    email: customer.email?.toLowerCase() || null
  };
  const fingerprintInput = JSON.stringify({
    version: 1,
    paymentMethod: "COD",
    customer: normalizedCustomer,
    items: normalizedItems
  });
  return {
    fingerprint: createHash("sha256").update(fingerprintInput).digest("hex"),
    items: normalizedItems
  };
}

function duplicateIndex(error, indexName) {
  const message = `${error.sqlMessage || ""} ${error.message || ""}`;
  return error.code === "ER_DUP_ENTRY" && message.includes(indexName);
}

async function findOrderByIdempotencyKey(connection, idempotencyKey) {
  const [rows] = await connection.execute(
    `SELECT order_number, total_amount, payment_method, payment_status, order_status, request_fingerprint
     FROM orders
     WHERE idempotency_key = ?`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

function normalizePhone(phone) {
  return phone.replace(/[\s-]/g, "").replace(/^\+91/, "");
}

async function getProductAvailability(pool, rawProductId) {
  const productId = requireText(rawProductId, "Product ID", 80);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(productId)) {
    throw new RequestError(400, "A product ID is invalid.");
  }

  const [products] = await pool.execute(
    `SELECT product_id
     FROM storefront_products
     WHERE product_id = ? AND is_active = 1
     LIMIT 1`,
    [productId]
  );
  if (!products[0]) {
    throw new RequestError(404, "The requested product was not found or is unavailable.");
  }

  const [rows] = await pool.execute(
    `SELECT size, stock_quantity
     FROM storefront_product_sizes
     WHERE product_id = ?
     ORDER BY size`,
    [productId]
  );
  const sizes = rows.map((row) => ({
    size: row.size,
    availableQuantity: Number(row.stock_quantity)
  }));

  if (FREE_SIZE_PRODUCT_IDS.has(productId) &&
      (sizes.length !== 1 || sizes[0].size !== "Free Size")) {
    throw new Error("The database returned invalid Free Size inventory.");
  }

  return { productId, sizes };
}

async function trackOrder(pool, requestBody) {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    throw new RequestError(400, "Enter an order number and registered phone number.");
  }

  const orderNumber = requireText(requestBody.orderNumber, "Order number", 32);
  const phone = requireText(requestBody.phone, "Registered phone number", 20);
  if (!/^[6-9]\d{9}$/.test(normalizePhone(phone))) {
    throw new RequestError(400, "Enter an order number and registered phone number.");
  }

  const [orders] = await pool.execute(
    `SELECT order_id, order_number, mobile_number, created_at, total_amount,
            payment_method, payment_status, order_status
     FROM orders
     WHERE order_number = ?
     LIMIT 1`,
    [orderNumber]
  );
  const order = orders[0];
  if (!order || normalizePhone(order.mobile_number) !== normalizePhone(phone)) {
    throw new RequestError(404, "The order number or phone number could not be verified.");
  }

  const [items] = await pool.execute(
    `SELECT product_name_snapshot, selected_size, quantity
     FROM order_items
     WHERE order_id = ?
     ORDER BY order_item_id`,
    [order.order_id]
  );
  const orderDate = order.created_at instanceof Date
    ? order.created_at
    : new Date(order.created_at);
  if (!Number.isFinite(orderDate.getTime())) {
    throw new Error("The database returned an invalid order date.");
  }

  return {
    orderNumber: order.order_number,
    orderDate: orderDate.toISOString(),
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

function orderResponse(order) {
  return {
    orderNumber: order.order_number,
    totalAmount: Number(order.total_amount),
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    orderStatus: order.order_status,
    created: false
  };
}

function priceToCents(price) {
  const text = String(price);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new Error("The database returned an invalid product price.");
  }
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new Error("The database returned an invalid product price.");
  }
  return cents;
}

function formatCents(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function newOrderNumber() {
  return `DB-${randomBytes(12).toString("hex")}`;
}

async function createOrder(
  pool,
  requestBody,
  rawIdempotencyKey,
  accountCustomerId = null,
  accountCustomerEmail = null
) {
  const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey);
  const { customer, items: validatedItems } = validateOrderPayload(requestBody);
  const { fingerprint, items } = createRequestFingerprint(customer, validatedItems);
  const authenticatedEmail = typeof accountCustomerEmail === "string"
    ? accountCustomerEmail.trim()
    : "";
  const notificationEmail = accountCustomerId === null
    ? customer.email
    : authenticatedEmail && EMAIL_PATTERN.test(authenticatedEmail)
      ? authenticatedEmail
      : null;
  const productIds = [...new Set(items.map((item) => item.productId))].sort();
  const connection = await pool.getConnection();
  let destroyConnection = false;

  try {
    for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      let transactionState = "clean";
      try {
        transactionState = "uncertain";
        await connection.beginTransaction();
        transactionState = "active";

        const products = new Map();
        for (const productId of productIds) {
          const [rows] = await connection.execute(
            `SELECT product_id, product_name, current_price, is_active
             FROM storefront_products
             WHERE product_id = ?
             FOR UPDATE`,
            [productId]
          );
          const product = rows[0];
          products.set(productId, product || null);
        }

        const existingOrder = await findOrderByIdempotencyKey(connection, idempotencyKey);
        if (existingOrder) {
          if (existingOrder.request_fingerprint !== fingerprint) {
            throw new RequestError(409, "This Idempotency-Key was already used for a different order.");
          }
          transactionState = "committing";
          await connection.commit();
          transactionState = "clean";
          return orderResponse(existingOrder);
        }

        for (const productId of productIds) {
          const product = products.get(productId);
          if (!product || Number(product.is_active) !== 1) {
            throw new RequestError(404, "A requested product was not found or is unavailable.");
          }

          const validSize = FREE_SIZE_PRODUCT_IDS.has(productId)
            ? items.filter((item) => item.productId === productId)
                .every((item) => item.size === "Free Size")
            : items.filter((item) => item.productId === productId)
                .every((item) => STANDARD_SIZES.has(item.size));
          if (!validSize) {
            throw new RequestError(400, "A selected size is not available for that product.");
          }
          products.set(productId, {
            ...product,
            priceCents: priceToCents(product.current_price)
          });
        }

        for (const item of items) {
          const [rows] = await connection.execute(
            `SELECT product_id, size, stock_quantity
             FROM storefront_product_sizes
             WHERE product_id = ? AND size = ?
             FOR UPDATE`,
            [item.productId, item.size]
          );
          const variant = rows[0];
          if (!variant) {
            throw new RequestError(409, `The selected size (${item.size}) is unavailable for this product.`);
          }
          if (Number(variant.stock_quantity) === 0) {
            throw new RequestError(409, `Size ${item.size} is out of stock.`);
          }
          if (Number(variant.stock_quantity) < item.quantity) {
            throw new RequestError(409, `There is not enough stock for size ${item.size}.`);
          }
        }

        let totalCents = 0;
        const pricedItems = items.map((item) => {
          const product = products.get(item.productId);
          const subtotalCents = product.priceCents * item.quantity;
          totalCents += subtotalCents;
          if (!Number.isSafeInteger(subtotalCents) || totalCents > MAX_ORDER_TOTAL_CENTS) {
            throw new RequestError(400, "The order total is too large to process.");
          }
          return { ...item, product, subtotalCents };
        });

        const orderNumber = newOrderNumber();
        let orderResult;
        try {
          [orderResult] = await connection.execute(
            `INSERT INTO orders
              (customer_id, order_number, customer_name, mobile_number, email, delivery_address, city, pin_code,
               total_amount, idempotency_key, request_fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              accountCustomerId,
              orderNumber,
              customer.name,
              customer.phone,
              notificationEmail,
              customer.address,
              customer.city,
              customer.pincode,
              formatCents(totalCents),
              idempotencyKey,
              fingerprint
            ]
          );
        } catch (error) {
          if (duplicateIndex(error, "uq_orders_idempotency_key")) {
            throw new IdempotencyKeyCollision();
          }
          if (duplicateIndex(error, "uq_orders_order_number")) {
            throw new OrderNumberCollision();
          }
          throw error;
        }

        for (const item of pricedItems) {
          await connection.execute(
            `INSERT INTO order_items
              (order_id, product_id, product_name_snapshot, product_price_snapshot,
               selected_size, quantity, item_subtotal)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              orderResult.insertId,
              item.productId,
              item.product.product_name,
              formatCents(item.product.priceCents),
              item.size,
              item.quantity,
              formatCents(item.subtotalCents)
            ]
          );
        }

        for (const item of items) {
          const [updateResult] = await connection.execute(
            `UPDATE storefront_product_sizes
             SET stock_quantity = stock_quantity - ?
             WHERE product_id = ? AND size = ? AND stock_quantity >= ?`,
            [item.quantity, item.productId, item.size, item.quantity]
          );
          if (updateResult.affectedRows !== 1) {
            throw new RequestError(409, `There is not enough stock for size ${item.size}.`);
          }
        }

        transactionState = "committing";
        await connection.commit();
        transactionState = "clean";

        return {
          orderNumber,
          totalAmount: Number(formatCents(totalCents)),
          paymentMethod: "COD",
          paymentStatus: "Pending",
          orderStatus: "Order Placed",
          created: true,
          notification: {
            email: notificationEmail,
            items: pricedItems.map((item) => ({
              productName: item.product.product_name,
              size: item.size,
              quantity: item.quantity,
              subtotal: Number(formatCents(item.subtotalCents))
            }))
          }
        };
      } catch (error) {
        let rollbackSucceeded = false;
        if (transactionState === "active" || transactionState === "uncertain") {
          try {
            await connection.rollback();
            transactionState = "clean";
            rollbackSucceeded = true;
          } catch (rollbackError) {
            destroyConnection = true;
            console.error("Order transaction rollback failed:", rollbackError.code || "database error");
          }
        } else if (transactionState === "committing") {
          destroyConnection = true;
        }

        if (error instanceof IdempotencyKeyCollision) {
          if (!rollbackSucceeded) {
            throw new Error("Idempotency key conflict could not be safely checked.");
          }
          const existingOrder = await findOrderByIdempotencyKey(connection, idempotencyKey);
          if (!existingOrder) {
            throw new Error("Idempotency key conflict could not be resolved.");
          }
          if (existingOrder.request_fingerprint !== fingerprint) {
            throw new RequestError(409, "This Idempotency-Key was already used for a different order.");
          }
          return orderResponse(existingOrder);
        }

        if (error instanceof OrderNumberCollision) {
          if (rollbackSucceeded && attempt + 1 < ORDER_NUMBER_ATTEMPTS) {
            continue;
          }
          if (!rollbackSucceeded) {
            throw new Error("Order number collision could not be safely retried.");
          }
          throw new RequestError(409, "Could not reserve a unique order number. Please try again.");
        }
        throw error;
      }
    }
  } finally {
    if (destroyConnection) {
      connection.destroy();
    } else {
      connection.release();
    }
  }

  throw new RequestError(409, "Could not reserve a unique order number. Please try again.");
}

async function readJsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
    throw new RequestError(400, "Send the order as application/json.");
  }

  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined && Number(contentLength) > MAX_BODY_BYTES) {
    request.resume();
    throw new RequestError(413, "The request body is too large.");
  }

  const chunks = [];
  let bodySize = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) {
    throw new RequestError(413, "The request body is too large.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "The request body contains malformed JSON.");
  }
}

module.exports = { createOrder, getProductAvailability, trackOrder, readJsonBody, RequestError };
