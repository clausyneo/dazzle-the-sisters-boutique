const http = require("node:http");
const fs = require("node:fs");
const { pool, testDatabaseConnection } = require("./database");
const {
  createOrder,
  getProductAvailability,
  trackOrder,
  readJsonBody,
  RequestError
} = require("./orders");
const {
  clearSessionCookie,
  getAuthenticatedCustomer,
  getCustomerOrder,
  listCustomerOrders,
  loginCustomer,
  logoutCustomer,
  registerCustomer,
  requestCustomerPasswordReset,
  resetCustomerPassword,
  sessionCookie,
  updateCustomerProfile
} = require("./accounts");
const {
  isEmailConfigured,
  sendCustomerPasswordResetEmail,
  sendCustomerLoginNotification,
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail
} = require("./email");
const {
  adminSessionCookie,
  clearAdminSessionCookie,
  getAdminOrder,
  getAuthenticatedAdmin,
  getDashboardSummary,
  listAdminOrders,
  loginAdmin,
  logoutAdmin,
  updateAdminOrderPaymentStatus,
  updateAdminOrderStatus
} = require("./admin");
const {
  MEASUREMENT_RANGES,
  createCustomerMeasurementProfile,
  deleteCustomerMeasurementProfile,
  getAdminMeasurementProfile,
  getCustomerMeasurementProfile,
  listAdminMeasurementProfiles,
  listCustomerMeasurementProfiles,
  updateMeasurementProfile
} = require("./measurements");

const port = Number(process.env.PORT || 3000);
const localFrontendOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];
const allowedMethods = "GET, POST, PATCH, OPTIONS";
const measurementProfileMethods = `${allowedMethods}, DELETE`;
const allowedHeaders = "Content-Type, Idempotency-Key";

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(data));
}

async function sendNotificationSafely(sender, message, label) {
  try {
    await sender(message);
  } catch (error) {
    console.error(`${label} email delivery failed:`, error && error.code ? error.code : "email error");
  }
}

function addCorsHeaders(request, response, allowedOrigins) {
  response.setHeader("Vary", "Origin");
  if (allowedOrigins.has(request.headers.origin)) {
    const requestPath = new URL(request.url, "http://localhost").pathname;
    const methods = /^\/api\/account\/measurement-profiles(?:\/\d+)?$/.test(requestPath)
      ? measurementProfileMethods
      : allowedMethods;
    response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
    response.setHeader("Access-Control-Allow-Methods", methods);
    response.setHeader("Access-Control-Allow-Headers", allowedHeaders);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

function isAllowedPreflight(request) {
  const requestedMethod = request.headers["access-control-request-method"];
  const requestedHeaders = (request.headers["access-control-request-headers"] || "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);

  const requestPath = new URL(request.url, "http://localhost").pathname;
  const isCustomerMeasurementProfilePath =
    /^\/api\/account\/measurement-profiles(?:\/\d+)?$/.test(requestPath);
  let allowedPreflightMethod;
  if (requestPath === "/api/orders") {
    allowedPreflightMethod = requestedMethod === "POST";
  } else if (requestedMethod === "DELETE") {
    allowedPreflightMethod = isCustomerMeasurementProfilePath;
  } else {
    allowedPreflightMethod = ["GET", "POST", "PATCH"].includes(requestedMethod);
  }

  return allowedPreflightMethod &&
    requestedHeaders.every((header) => ["content-type", "idempotency-key"].includes(header));
}

function createServer(options = {}) {
  const databasePool = options.pool || pool;
  const checkDatabaseConnection = options.testDatabaseConnection || testDatabaseConnection;
  const configuredFrontendOrigins = [
    options.frontendOrigin || process.env.FRONTEND_ORIGIN,
    options.adminFrontendOrigin || process.env.ADMIN_FRONTEND_ORIGIN
  ].flatMap((value) => (value || "").split(",").map((origin) => origin.trim()))
    .filter(Boolean);
  const allowedOrigins = new Set([
    ...localFrontendOrigins,
    ...configuredFrontendOrigins
  ]);
  const trackingLimit = Number.isSafeInteger(options.trackingLimit) && options.trackingLimit > 0
    ? options.trackingLimit
    : 10;
  const trackingWindowMs = Number.isSafeInteger(options.trackingWindowMs) && options.trackingWindowMs > 0
    ? options.trackingWindowMs
    : 15 * 60 * 1000;
  const trackingAttempts = new Map();
  const accountAttemptLimit = Number.isSafeInteger(options.accountAttemptLimit) && options.accountAttemptLimit > 0
    ? options.accountAttemptLimit
    : 10;
  const accountAttemptWindowMs = Number.isSafeInteger(options.accountAttemptWindowMs) &&
      options.accountAttemptWindowMs > 0
    ? options.accountAttemptWindowMs
    : 15 * 60 * 1000;
  const accountAttempts = new Map();
  const passwordResetRequestAttempts = new Map();
  const passwordResetSubmitAttempts = new Map();
  const adminAttemptLimit = Number.isSafeInteger(options.adminAttemptLimit) && options.adminAttemptLimit > 0
    ? options.adminAttemptLimit
    : 10;
  const adminAttemptWindowMs = Number.isSafeInteger(options.adminAttemptWindowMs) &&
      options.adminAttemptWindowMs > 0
    ? options.adminAttemptWindowMs
    : 15 * 60 * 1000;
  const adminAttempts = new Map();

  function allowAccountAttempt(request) {
    const now = Date.now();
    for (const [address, attempt] of accountAttempts) {
      if (attempt.resetAt <= now) accountAttempts.delete(address);
    }
    const address = request.socket.remoteAddress || "unknown";
    let attempt = accountAttempts.get(address);
    if (!attempt || attempt.resetAt <= now) {
      attempt = { count: 0, resetAt: now + accountAttemptWindowMs };
      accountAttempts.set(address, attempt);
    }
    if (attempt.count >= accountAttemptLimit) return false;
    attempt.count += 1;
    return true;
  }

  function allowPasswordResetAttempt(attempts, request, limit) {
    const now = Date.now();
    const windowMs = options.passwordResetAttemptWindowMs || 15 * 60 * 1000;
    for (const [address, attempt] of attempts) {
      if (attempt.resetAt <= now) attempts.delete(address);
    }

    const address = request.socket.remoteAddress || "unknown";
    let attempt = attempts.get(address);
    if (!attempt || attempt.resetAt <= now) {
      attempt = { count: 0, resetAt: now + windowMs };
      attempts.set(address, attempt);
    }
    if (attempt.count >= limit) return false;
    attempt.count += 1;
    return true;
  }

  function requireAccountOrigin(request, response) {
    if (allowedOrigins.has(request.headers.origin)) return true;
    sendJson(response, 403, { success: false, message: "This account request is not allowed." });
    return false;
  }

  function requireAdminOrigin(request, response) {
    if (allowedOrigins.has(request.headers.origin)) return true;
    sendJson(response, 403, { success: false, message: "This admin request is not allowed." });
    return false;
  }

  function allowAdminAttempt(request) {
    const now = Date.now();
    for (const [address, attempt] of adminAttempts) {
      if (attempt.resetAt <= now) adminAttempts.delete(address);
    }

    const address = request.socket.remoteAddress || "unknown";
    let attempt = adminAttempts.get(address);
    if (!attempt || attempt.resetAt <= now) {
      attempt = { count: 0, resetAt: now + adminAttemptWindowMs };
      adminAttempts.set(address, attempt);
    }
    if (attempt.count >= adminAttemptLimit) return false;
    attempt.count += 1;
    return true;
  }

  function allowTrackingAttempt(request) {
    const now = Date.now();
    for (const [address, attempt] of trackingAttempts) {
      if (attempt.resetAt <= now) trackingAttempts.delete(address);
    }

    const address = request.socket.remoteAddress || "unknown";
    let attempt = trackingAttempts.get(address);
    if (!attempt || attempt.resetAt <= now) {
      attempt = { count: 0, resetAt: now + trackingWindowMs };
      trackingAttempts.set(address, attempt);
    }
    if (attempt.count >= trackingLimit) return false;
    attempt.count += 1;
    return true;
  }

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");
    addCorsHeaders(request, response, allowedOrigins);

    if (request.method === "OPTIONS") {
      if (!requestUrl.pathname.startsWith("/api/") ||
          !allowedOrigins.has(request.headers.origin) ||
          !isAllowedPreflight(request)) {
        sendJson(response, 403, { status: "error", message: "CORS preflight is not allowed." });
        return;
      }

      response.writeHead(204);
      response.end();
      return;
    }

    if (requestUrl.pathname === "/api/measurement-rules" && request.method === "GET") {
      sendJson(response, 200, { success: true, ranges: MEASUREMENT_RANGES });
      return;
    }

    if (requestUrl.pathname === "/api/orders" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const customer = await getAuthenticatedCustomer(databasePool, request);
        const result = await createOrder(
          databasePool,
          body,
          request.headers["idempotency-key"],
          customer ? customer.customerId : null,
          customer ? customer.email : null
        );
        if (result.created && result.notification && result.notification.email) {
          await sendNotificationSafely(
            options.sendOrderConfirmationEmail || sendOrderConfirmationEmail,
            {
              email: result.notification.email,
              order: {
                orderNumber: result.orderNumber,
                totalAmount: result.totalAmount,
                paymentMethod: result.paymentMethod,
                orderStatus: result.orderStatus,
                items: result.notification.items
              }
            },
            "Order confirmation"
          );
        }
        sendJson(response, 201, {
          success: true,
          orderNumber: result.orderNumber,
          totalAmount: result.totalAmount,
          paymentMethod: result.paymentMethod,
          paymentStatus: result.paymentStatus,
          orderStatus: result.orderStatus,
          message: "Your order has been placed successfully."
        });
      } catch (error) {
        if (error instanceof RequestError) {
          sendJson(response, error.statusCode, { success: false, message: error.message });
          return;
        }
        console.error("Order creation failed:", error.code || "unexpected error");
        sendJson(response, 500, { success: false, message: "Unable to place the order right now." });
      }
      return;
    }

    if (requestUrl.pathname.startsWith("/api/admin/")) {
      const path = requestUrl.pathname;
      const method = request.method;
      const needsOriginCheck = method !== "GET";
      if (needsOriginCheck && !requireAdminOrigin(request, response)) return;

      try {
        if (path === "/api/admin/login" && method === "POST") {
          if (!allowAdminAttempt(request)) {
            sendJson(response, 429, {
              success: false,
              message: "Too many admin login attempts. Please wait before trying again."
            });
            return;
          }
          const result = await loginAdmin(databasePool, await readJsonBody(request));
          sendJson(response, 200, {
            success: true,
            admin: result.admin
          }, { "Set-Cookie": adminSessionCookie(result.token) });
          return;
        }

        if (path === "/api/admin/logout" && method === "POST") {
          await logoutAdmin(databasePool, request);
          sendJson(response, 200, { success: true }, {
            "Set-Cookie": clearAdminSessionCookie()
          });
          return;
        }

        if (path === "/api/admin/me" && method === "GET") {
          const admin = await getAuthenticatedAdmin(databasePool, request);
          if (!admin) {
            sendJson(response, 401, { success: false, message: "Please sign in as an admin." });
            return;
          }
          sendJson(response, 200, { success: true, admin });
          return;
        }

        const admin = await getAuthenticatedAdmin(databasePool, request);
        if (!admin) {
          sendJson(response, 401, { success: false, message: "Please sign in as an admin." });
          return;
        }

        if (path === "/api/admin/dashboard" && method === "GET") {
          const summary = await getDashboardSummary(databasePool);
          sendJson(response, 200, { success: true, summary });
          return;
        }

        if (path === "/api/admin/measurement-profiles" && method === "GET") {
          const result = await listAdminMeasurementProfiles(databasePool, requestUrl.searchParams);
          sendJson(response, 200, { success: true, ...result });
          return;
        }

        const adminMeasurementProfileMatch =
          /^\/api\/admin\/measurement-profiles\/([^/]+)$/.exec(path);
        if (adminMeasurementProfileMatch && method === "GET") {
          const profile = await getAdminMeasurementProfile(
            databasePool,
            adminMeasurementProfileMatch[1]
          );
          sendJson(response, 200, { success: true, profile });
          return;
        }

        if (adminMeasurementProfileMatch && method === "PATCH") {
          const profile = await updateMeasurementProfile(
            databasePool,
            adminMeasurementProfileMatch[1],
            null,
            await readJsonBody(request),
            { type: "ADMIN", id: admin.adminId }
          );
          sendJson(response, 200, { success: true, profile });
          return;
        }

        if (path === "/api/admin/orders" && method === "GET") {
          const result = await listAdminOrders(databasePool, requestUrl.searchParams);
          sendJson(response, 200, { success: true, ...result });
          return;
        }

        const statusMatch = /^\/api\/admin\/orders\/([^/]+)\/status$/.exec(path);
        if (statusMatch && method === "PATCH") {
          const body = await readJsonBody(request);
          const result = await updateAdminOrderStatus(databasePool, statusMatch[1], body.orderStatus);
          if (result.changed && result.notification && result.notification.email) {
            await sendNotificationSafely(
              options.sendOrderStatusUpdateEmail || sendOrderStatusUpdateEmail,
              {
                email: result.notification.email,
                order: result.notification.order
              },
              "Order status"
            );
          }
          sendJson(response, 200, {
            success: true,
            order: {
              orderId: result.orderId,
              orderStatus: result.orderStatus
            }
          });
          return;
        }

        const paymentStatusMatch = /^\/api\/admin\/orders\/([^/]+)\/payment-status$/.exec(path);
        if (paymentStatusMatch && method === "PATCH") {
          const result = await updateAdminOrderPaymentStatus(databasePool, paymentStatusMatch[1]);
          sendJson(response, 200, {
            success: true,
            order: {
              orderId: result.orderId,
              paymentStatus: result.paymentStatus,
              orderStatus: result.orderStatus
            }
          });
          return;
        }

        const orderMatch = /^\/api\/admin\/orders\/([^/]+)$/.exec(path);
        if (orderMatch && method === "GET") {
          const order = await getAdminOrder(databasePool, orderMatch[1]);
          sendJson(response, 200, { success: true, order });
          return;
        }

        sendJson(response, 404, { success: false, message: "Admin route not found." });
      } catch (error) {
        if (error instanceof RequestError) {
          sendJson(response, error.statusCode, { success: false, message: error.message });
          return;
        }
        console.error("Admin request failed:", error.code || "unexpected error");
        sendJson(response, 500, {
          success: false,
          message: "Unable to complete the admin request right now."
        }, path === "/api/admin/logout" ? {
          "Set-Cookie": clearAdminSessionCookie()
        } : {});
      }
      return;
    }

    if (requestUrl.pathname.startsWith("/api/account/")) {
      const method = request.method;
      const path = requestUrl.pathname;
      const needsOriginCheck = method !== "GET";
      if (needsOriginCheck && !requireAccountOrigin(request, response)) return;

      try {
        if (path === "/api/account/forgot-password" && method === "POST") {
          if (!allowPasswordResetAttempt(
            passwordResetRequestAttempts,
            request,
            options.passwordResetRequestLimit || 5
          )) {
            sendJson(response, 429, {
              success: false,
              message: "Too many password recovery requests. Please wait before trying again."
            });
            return;
          }
          const result = await requestCustomerPasswordReset(
            databasePool,
            await readJsonBody(request),
            options.sendPasswordResetEmail || sendCustomerPasswordResetEmail,
            options.passwordResetEmailConfigured ?? isEmailConfigured()
          );
          sendJson(response, 200, result);
          return;
        }

        if (path === "/api/account/reset-password" && method === "POST") {
          if (!allowPasswordResetAttempt(
            passwordResetSubmitAttempts,
            request,
            options.passwordResetSubmitLimit || 10
          )) {
            sendJson(response, 429, {
              success: false,
              message: "Too many password reset attempts. Please wait before trying again."
            });
            return;
          }
          const result = await resetCustomerPassword(databasePool, await readJsonBody(request));
          sendJson(response, 200, result);
          return;
        }

        if ((path === "/api/account/register" || path === "/api/account/login") &&
            method === "POST") {
          if (!allowAccountAttempt(request)) {
            sendJson(response, 429, {
              success: false,
              message: "Too many account attempts. Please wait before trying again."
            });
            return;
          }
          const body = await readJsonBody(request);
          const result = path.endsWith("/register")
            ? await registerCustomer(databasePool, body)
            : await loginCustomer(databasePool, body);
          if (path.endsWith("/login")) {
  void sendNotificationSafely(
    options.sendCustomerLoginNotification || sendCustomerLoginNotification,
    {
      email: result.customer.email,
      loginAt: new Date().toISOString()
    },
    "Customer login"
  ).catch((error) => {
    console.error("Customer login notification failed:", error.code || "unexpected error");
  });
}
          sendJson(response, 200, {
            success: true,
            customer: result.customer
          }, { "Set-Cookie": sessionCookie(result.token) });
          return;
        }

        if (path === "/api/account/logout" && method === "POST") {
          await logoutCustomer(databasePool, request);
          sendJson(response, 200, { success: true }, {
            "Set-Cookie": clearSessionCookie()
          });
          return;
        }

        if (path === "/api/account/measurement-profiles" &&
            (method === "GET" || method === "POST")) {
          const customer = await getAuthenticatedCustomer(databasePool, request);
          if (!customer) {
            sendJson(response, 401, { success: false, message: "Please sign in to continue." });
            return;
          }
          if (method === "GET") {
            const profiles = await listCustomerMeasurementProfiles(
              databasePool,
              customer.customerId
            );
            sendJson(response, 200, { success: true, profiles });
            return;
          }
          const profile = await createCustomerMeasurementProfile(
            databasePool,
            customer.customerId,
            await readJsonBody(request)
          );
          sendJson(response, 201, { success: true, profile });
          return;
        }

        const customerMeasurementProfileMatch =
          /^\/api\/account\/measurement-profiles\/([^/]+)$/.exec(path);
        if (customerMeasurementProfileMatch &&
            ["GET", "PATCH", "DELETE"].includes(method)) {
          const customer = await getAuthenticatedCustomer(databasePool, request);
          if (!customer) {
            sendJson(response, 401, { success: false, message: "Please sign in to continue." });
            return;
          }
          const profileId = customerMeasurementProfileMatch[1];
          if (method === "GET") {
            const profile = await getCustomerMeasurementProfile(
              databasePool,
              customer.customerId,
              profileId
            );
            sendJson(response, 200, { success: true, profile });
            return;
          }
          if (method === "PATCH") {
            const profile = await updateMeasurementProfile(
              databasePool,
              profileId,
              customer.customerId,
              await readJsonBody(request),
              { type: "CUSTOMER", id: customer.customerId }
            );
            sendJson(response, 200, { success: true, profile });
            return;
          }
          const result = await deleteCustomerMeasurementProfile(
            databasePool,
            customer.customerId,
            profileId
          );
          sendJson(response, 200, { success: true, ...result });
          return;
        }

        if (path === "/api/account/me" && (method === "GET" || method === "PATCH")) {
          const customer = await getAuthenticatedCustomer(databasePool, request);
          if (!customer) {
            sendJson(response, 401, { success: false, message: "Please sign in to continue." });
            return;
          }
          const profile = method === "PATCH"
            ? await updateCustomerProfile(databasePool, customer.customerId, await readJsonBody(request))
            : customer;
          sendJson(response, 200, { success: true, customer: profile });
          return;
        }

        if (path === "/api/account/orders" && method === "GET") {
          const customer = await getAuthenticatedCustomer(databasePool, request);
          if (!customer) {
            sendJson(response, 401, { success: false, message: "Please sign in to continue." });
            return;
          }
          const orders = await listCustomerOrders(databasePool, customer.customerId);
          sendJson(response, 200, { success: true, orders });
          return;
        }

        const orderMatch = /^\/api\/account\/orders\/([^/]+)$/.exec(path);
        if (orderMatch && method === "GET") {
          const customer = await getAuthenticatedCustomer(databasePool, request);
          if (!customer) {
            sendJson(response, 401, { success: false, message: "Please sign in to continue." });
            return;
          }
          const order = await getCustomerOrder(databasePool, customer.customerId, orderMatch[1]);
          sendJson(response, 200, { success: true, order });
          return;
        }

        sendJson(response, 404, { success: false, message: "Account route not found." });
      } catch (error) {
        if (error instanceof RequestError) {
          sendJson(response, error.statusCode, { success: false, message: error.message });
          return;
        }
        console.error("Account request failed:", error.code || "unexpected error");
        sendJson(response, 500, {
          success: false,
          message: "Unable to complete the account request right now."
        }, path === "/api/account/logout" ? {
          "Set-Cookie": clearSessionCookie()
        } : {});
      }
      return;
    }

    if (requestUrl.pathname === "/api/orders/track" && request.method === "POST") {
      if (!allowTrackingAttempt(request)) {
        sendJson(response, 429, {
          success: false,
          message: "Too many tracking attempts. Please wait before trying again."
        });
        return;
      }

      try {
        const body = await readJsonBody(request);
        const order = await trackOrder(databasePool, body);
        sendJson(response, 200, { success: true, order });
      } catch (error) {
        if (error instanceof RequestError) {
          sendJson(response, error.statusCode, { success: false, message: error.message });
          return;
        }
        console.error("Order tracking failed:", error.code || "unexpected error");
        sendJson(response, 500, {
          success: false,
          message: "Unable to retrieve this order right now."
        });
      }
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { status: "error", message: "Only GET requests are supported." });
      return;
    }

    const availabilityMatch = /^\/api\/products\/([^/]+)\/availability$/.exec(requestUrl.pathname);
    if (availabilityMatch) {
      let productId;
      try {
        productId = decodeURIComponent(availabilityMatch[1]);
      } catch (error) {
        sendJson(response, 400, { success: false, message: "A product ID is invalid." });
        return;
      }

      try {
        const availability = await getProductAvailability(databasePool, productId);
        sendJson(response, 200, { success: true, ...availability });
      } catch (error) {
        if (error instanceof RequestError) {
          sendJson(response, error.statusCode, { success: false, message: error.message });
          return;
        }
        console.error("Product availability lookup failed:", error.code || "unexpected error");
        sendJson(response, 500, {
          success: false,
          message: "Unable to retrieve product availability right now."
        });
      }
      return;
    }

    if (requestUrl.pathname === "/api/status") {
      sendJson(response, 200, { status: "ok", message: "Dazzle Boutique API is running." });
      return;
    }

    if (requestUrl.pathname === "/api/deployment-check" && request.method === "GET") {
      const caPath = process.env.DB_SSL_CA_PATH;
      sendJson(response, 200, {
        status: "ok",
        checks: {
          dbSslCaPathSet: Boolean(caPath),
          dbSslCaFileExists: Boolean(caPath && fs.existsSync(caPath)),
          dbHostSet: Boolean(process.env.DB_HOST),
          dbUserSet: Boolean(process.env.DB_USER),
          dbPasswordSet: Boolean(process.env.DB_PASSWORD),
          dbNameSet: Boolean(process.env.DB_NAME),
          nodeEnvProduction: process.env.NODE_ENV === "production"
        }
      });
      return;
    }

    if (requestUrl.pathname === "/api/db-status") {
      try {
        await checkDatabaseConnection();
        sendJson(response, 200, { status: "ok", message: "MySQL is connected." });
      } catch (error) {
        console.error("MySQL connection check failed:", {
          code: error.code,
          errno: error.errno,
          sqlState: error.sqlState,
          message: error.sqlMessage || error.message
        });
        sendJson(response, 503, {
          status: "error",
          message: "MySQL is not connected. Check the MySQL service and .env settings."
        });
      }
      return;
    }

    sendJson(response, 404, { status: "error", message: "Route not found." });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Dazzle Boutique API is listening on port ${port}`);
  });
}

module.exports = { createServer };
