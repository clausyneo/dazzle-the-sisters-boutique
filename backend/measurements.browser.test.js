"use strict";

const assert = require("node:assert/strict");
const { randomBytes, randomInt, createHash } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { chromium } = require("playwright");
const {
  applyTestDatabaseEnvironment,
  databaseConnectionOptions,
  readTestDatabaseConfig,
  verifyDatabaseTarget
} = require("./test-db-safety");
const { createAdminAccount } = require("./admin");

const ROOT = path.resolve(__dirname, "..");
const FRONTEND_ROOT = path.join(ROOT, "frontend");
const TABLES = [
  "admin_sessions",
  "admin_users",
  "customer_measurement_profiles",
  "customer_measurement_values",
  "customer_sessions",
  "customers"
];
const REQUIRED_COLUMNS = {
  admin_sessions: ["session_id", "admin_id", "token_hash", "expires_at", "created_at"],
  admin_users: [
    "admin_id", "username", "password_salt", "password_hash",
    "is_active", "created_at", "updated_at"
  ],
  customer_measurement_profiles: [
    "profile_id", "customer_id", "garment_category", "profile_name",
    "unit_preference", "fitting_preference", "notes", "last_updated_by_type",
    "last_updated_by_id", "created_at", "updated_at"
  ],
  customer_measurement_values: ["profile_id", "measurement_key", "value_cm"],
  customer_sessions: ["session_id", "customer_id", "token_hash", "expires_at", "created_at"],
  customers: [
    "customer_id", "name", "phone", "email", "password_salt",
    "password_hash", "created_at", "updated_at"
  ]
};
const REQUIRED_FOREIGN_KEYS = [
  "admin_sessions|admin_id|admin_users|admin_id|CASCADE",
  "customer_measurement_profiles|customer_id|customers|customer_id|CASCADE",
  "customer_measurement_values|profile_id|customer_measurement_profiles|profile_id|CASCADE",
  "customer_sessions|customer_id|customers|customer_id|CASCADE"
];
const GARMENT_FIELDS = {
  BLOUSE: [
    "bust", "waist", "shoulder", "armhole", "sleeve_length",
    "blouse_length", "front_neck_depth", "back_neck_depth"
  ],
  SUIT_SALWAR_KAMEEZ: [
    "bust", "waist", "hip", "shoulder", "armhole", "sleeve_length",
    "top_length", "trouser_waist", "trouser_hip", "trouser_length", "inseam"
  ],
  LEHENGA: [
    "blouse_bust", "blouse_waist", "blouse_shoulder", "blouse_sleeve_length",
    "lehenga_waist", "lehenga_hip", "lehenga_length"
  ],
  KURTI: ["bust", "waist", "hip", "shoulder", "armhole", "sleeve_length", "kurti_length"],
  PANTS_PALAZZO: ["waist", "hip", "thigh", "inseam", "outseam", "ankle_opening"],
  ANARKALI_GOWN: ["bust", "waist", "hip", "shoulder", "armhole", "sleeve_length", "gown_length"]
};
const GUIDE_TITLES = [
  "Bust / Chest", "Waist", "Hips", "Shoulder", "Armhole",
  "Bicep", "Sleeve Length", "Garment Length", "Inseam"
];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};
const RESULT = { passed: 0, failed: 0 };
const activePages = new Map();
let activeStage = "test setup";
let failureLogged = false;
let cleanupStatus = "not run (safety preflight did not pass)";
let preflightPassed = false;
let databasePool;
let browser;
let staticServer;
let apiServer;
let directConfig;
let apiOrigin;
let frontendOrigin;
let owner;
let otherCustomer;
let admin;
let adminCreated = false;
let ownerProfileId = null;

function randomPassword(length) {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

function randomPhone() {
  return `${randomInt(6, 10)}${Array.from({ length: 9 }, () => randomInt(10)).join("")}`;
}

function createCustomerIdentity(role, nonce) {
  return {
    name: `RMS E2E ${role} ${nonce}`,
    phone: randomPhone(),
    email: `rms-e2e-${role}-${nonce}@example.invalid`,
    password: randomPassword(12)
  };
}

function createAdminIdentity(nonce) {
  return {
    username: `rms-e2e-${nonce}`,
    password: randomPassword(16),
    adminId: null
  };
}

async function assertVisible(locator, message) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await locator.isVisible(), true, message);
}

async function assertHidden(locator, message) {
  await locator.waitFor({ state: "hidden", timeout: 15000 });
  assert.equal(await locator.isVisible(), false, message);
}

async function listenLoopback(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  assert.ok(address && address.address === "127.0.0.1" && address.port > 0);
  return `http://127.0.0.1:${address.port}`;
}

function createFrontendServer(getApiOrigin) {
  return http.createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }

      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }

      if (pathname === "/js/config.js") {
        const configuredApiOrigin = getApiOrigin();
        if (!configuredApiOrigin) {
          response.writeHead(503, { "Cache-Control": "no-store" });
          response.end();
          return;
        }
        const body = `window.DAZZLE_CONFIG = Object.freeze({ API_BASE_URL: ${JSON.stringify(configuredApiOrigin)} });`;
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": MIME_TYPES[".js"]
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }

      const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = path.resolve(FRONTEND_ROOT, requestedPath);
      const relativePath = path.relative(FRONTEND_ROOT, filePath);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        response.writeHead(403);
        response.end();
        return;
      }

      let contents;
      try {
        contents = await fs.promises.readFile(filePath);
      } catch {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": contents.length,
        "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] ||
          "application/octet-stream"
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function readTableCounts(connection) {
  const counts = {};
  for (const table of TABLES) {
    const [rows] = await connection.execute(`SELECT COUNT(*) AS row_count FROM \`${table}\``);
    counts[table] = Number(rows[0].row_count);
  }
  return counts;
}

async function verifyTestSchema(connection) {
  const [tables] = await connection.execute(
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
  );
  assert.deepEqual(tables.map((row) => row.TABLE_NAME), TABLES);
  assert.ok(tables.every((row) =>
    row.ENGINE === "InnoDB" &&
    typeof row.TABLE_COLLATION === "string" &&
    row.TABLE_COLLATION.startsWith("utf8mb4_")
  ));

  for (const [table, expectedColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [table]
    );
    assert.deepEqual(columns.map((column) => column.COLUMN_NAME), expectedColumns);
  }

  const [foreignKeys] = await connection.execute(
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
  const actualForeignKeys = foreignKeys.map((row) =>
    [
      row.TABLE_NAME,
      row.COLUMN_NAME,
      row.REFERENCED_TABLE_NAME,
      row.REFERENCED_COLUMN_NAME,
      String(row.DELETE_RULE).toUpperCase()
    ].join("|")
  ).sort();
  assert.deepEqual(actualForeignKeys, REQUIRED_FOREIGN_KEYS);
}

async function verifySafeEmptyDatabase(connection) {
  const target = await verifyDatabaseTarget(connection);
  assert.equal(target.database, "dazzle_boutique_test");
  assert.equal(target.globalMode.toLowerCase(), "pessimistic");
  assert.equal(target.sessionMode.toLowerCase(), "pessimistic");
  await verifyTestSchema(connection);
  const counts = await readTableCounts(connection);
  assert.ok(Object.values(counts).every((count) => count === 0));
  return target;
}

async function verifyApplicationPool() {
  const connection = await databasePool.getConnection();
  try {
    return await verifySafeEmptyDatabase(connection);
  } finally {
    connection.release();
  }
}

async function startApplicationServers() {
  let currentApiOrigin = null;
  staticServer = createFrontendServer(() => currentApiOrigin);
  frontendOrigin = await listenLoopback(staticServer);

  const application = require("./server");
  apiServer = application.createServer({
    frontendOrigin,
    adminFrontendOrigin: frontendOrigin,
    pool: databasePool,
    testDatabaseConnection: async () => true,
    sendCustomerLoginNotification: async () => {},
    sendPasswordResetEmail: async () => {},
    sendOrderConfirmationEmail: async () => {},
    sendOrderStatusUpdateEmail: async () => {}
  });
  apiOrigin = await listenLoopback(apiServer);
  currentApiOrigin = apiOrigin;

  const response = await fetch(`${apiOrigin}/api/status`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
}

async function installLocalOnlyRequests(context, mockUnrelatedAdminOrders = false) {
  await context.route("**/*", async (route) => {
    let requestUrl;
    try {
      requestUrl = new URL(route.request().url());
    } catch {
      await route.abort();
      return;
    }

    if (requestUrl.origin !== frontendOrigin && requestUrl.origin !== apiOrigin) {
      await route.abort();
      return;
    }

    if (
      mockUnrelatedAdminOrders &&
      requestUrl.origin === apiOrigin &&
      route.request().method() === "GET" &&
      requestUrl.pathname === "/api/admin/dashboard"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": frontendOrigin,
          "access-control-allow-credentials": "true"
        },
        body: JSON.stringify({
          success: true,
          summary: { totalOrders: 0, pendingOrders: 0, completedOrders: 0, orderValue: 0 }
        })
      });
      return;
    }

    if (
      mockUnrelatedAdminOrders &&
      requestUrl.origin === apiOrigin &&
      route.request().method() === "GET" &&
      requestUrl.pathname === "/api/admin/orders"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": frontendOrigin,
          "access-control-allow-credentials": "true"
        },
        body: JSON.stringify({
          success: true,
          orders: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }
        })
      });
      return;
    }

    await route.continue();
  });
}

function safeFailure(error) {
  const name = error && typeof error.name === "string" ? error.name : "Error";
  const code = error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
    ? ` (${error.code})`
    : "";
  const locations = typeof error.stack === "string"
    ? error.stack.split("\n")
      .filter((line) => line.includes("measurements.browser.test.js"))
      .slice(0, 2)
      .map((line) => line.trim())
      .join(" <- ")
    : "";
  return `${name}${code}${locations ? ` at ${locations}` : ""}; sensitive details suppressed`;
}

async function captureFailureScreenshots(stage) {
  const outputDirectory = path.join(ROOT, "test-results");
  try {
    await fs.promises.mkdir(outputDirectory, { recursive: true });
  } catch {
    console.error("Could not create the browser failure screenshot directory.");
    return;
  }

  const suffix = stage.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let index = 0;
  for (const [label, page] of activePages) {
    if (page.isClosed()) continue;
    index += 1;
    const filePath = path.join(outputDirectory, `browser-failure-${suffix}-${index}.png`);
    try {
      await page.screenshot({ path: filePath, fullPage: true, timeout: 10000 });
      console.log(`[SCREENSHOT] ${path.relative(ROOT, filePath)} (${label})`);
    } catch {
      console.error(`Could not capture a browser screenshot for ${label}.`);
    }
  }
}

async function runStage(name, action) {
  activeStage = name;
  try {
    await action();
    RESULT.passed += 1;
    console.log(`[PASS] browser: ${name}`);
  } catch (error) {
    RESULT.failed += 1;
    failureLogged = true;
    console.error(`[FAIL] browser: ${name} — ${safeFailure(error)}`);
    await captureFailureScreenshots(name);
    throw error;
  }
}

function makeBrowserFailure(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

async function registerCustomer(page, identity, returnToStudio) {
  const returnQuery = returnToStudio ? "?returnTo=measurement-studio.html" : "";
  await page.goto(`${frontendOrigin}/account-register.html${returnQuery}`, {
    waitUntil: "domcontentloaded"
  });
  await page.locator("#account-name").fill(identity.name);
  await page.locator("#account-phone").fill(identity.phone);
  await page.locator("#account-email").fill(identity.email);
  await page.locator("#account-password").fill(identity.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL(/measurement-studio\.html|my-account\.html/, { timeout: 15000 });
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    "The responsive layout overflows horizontally."
  );
}

async function verifyOwnerDatabaseState(profileId) {
  const connection = await databasePool.getConnection();
  try {
    await verifyDatabaseTarget(connection);
    const [rows] = await connection.execute(
      `SELECT value_cm
       FROM customer_measurement_values
       WHERE profile_id = ? AND measurement_key = 'bust'`,
      [profileId]
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].value_cm), 91.44);
  } finally {
    connection.release();
  }
}

async function verifyAdminAttribution(profileId) {
  const connection = await databasePool.getConnection();
  try {
    await verifyDatabaseTarget(connection);
    const [rows] = await connection.execute(
      `SELECT last_updated_by_type, last_updated_by_id
       FROM customer_measurement_profiles
       WHERE profile_id = ? AND customer_id = (
         SELECT customer_id FROM customers WHERE name = ? AND email = ?
       )`,
      [profileId, owner.name, owner.email]
    );
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].last_updated_by_type).toUpperCase(), "ADMIN");
    assert.equal(Number(rows[0].last_updated_by_id), admin.adminId);
  } finally {
    connection.release();
  }
}

async function runBrowserJourneys() {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  await installLocalOnlyRequests(context);
  const page = await context.newPage();
  activePages.set("customer desktop", page);

  await runStage("desktop storefront navigation, sign-in gate, and nine guides", async () => {
    await page.goto(`${frontendOrigin}/index.html`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Visit the Royal Measurement Studio" }).click();
    await assertVisible(page.locator("#studio-auth-notice"));
    await assertHidden(page.locator("#measurement-form"));
    await assertHidden(page.locator("#book-content"));

    const guides = await page.locator(".studio-guide-card h3").allTextContents();
    assert.deepEqual(guides.map((title) => title.trim()), GUIDE_TITLES);

    await page.locator("#book-start-measuring").click();
    await assertVisible(page.locator("#studio-auth-notice"));
    await assertHidden(page.locator("#measurement-form"));
  });

  await runStage("customer registration, login, validation, categories, units, create and edit", async () => {
    await page.locator("#studio-register-link").click();
    await page.locator("#account-name").fill(owner.name);
    await page.locator("#account-phone").fill(owner.phone);
    await page.locator("#account-email").fill(owner.email);
    const passwordInput = page.locator("#account-password");
    await passwordInput.fill("abc123");
    await page.getByRole("button", { name: "Create Account" }).click();
    assert.equal(
      await passwordInput.evaluate((input) => input.validity.tooShort),
      true,
      "The browser did not enforce the registration password minimum."
    );

    await passwordInput.fill(owner.password);
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.waitForURL(/measurement-studio\.html/, { timeout: 15000 });
    await assertVisible(page.locator("#measurement-form"));

    await page.locator(".menu-toggle").click();
    const customerLogout = page.locator(".menu-account-logout");
    await assertVisible(customerLogout);
    await customerLogout.click();
    await page.waitForURL(/account-login\.html/, { timeout: 15000 });

    await page.locator("#account-identifier").fill(owner.email);
    await page.locator("#account-password").fill(`wrong-${randomPassword(8)}`);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.getByText("The email/phone or password is incorrect.", { exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    assert.match(
      await page.locator("#account-form-message").innerText(),
      /email\/phone or password is incorrect/i
    );

    await page.locator("#account-password").fill(owner.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL(/my-account\.html/, { timeout: 15000 });

    let delayedBookLoad = false;
    const delayMeasurementList = async (route) => {
      if (route.request().method() === "GET") {
        delayedBookLoad = true;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      await route.continue();
    };
    await page.route("**/api/account/measurement-profiles", delayMeasurementList);
    const listResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/account/measurement-profiles" &&
      response.request().method() === "GET"
    );
    await page.goto(`${frontendOrigin}/measurement-studio.html`, {
      waitUntil: "domcontentloaded"
    });
    await assertVisible(page.locator("#book-loading"));
    await listResponse;
    await page.unroute("**/api/account/measurement-profiles", delayMeasurementList);
    assert.equal(delayedBookLoad, true);
    await assertVisible(page.locator("#book-empty-state"));

    await page.locator("#start-measuring").click();
    const categorySelect = page.locator("#profile-category");
    const profileName = `RMS E2E ${randomBytes(8).toString("hex")} Blouse`;
    const profileNameInput = page.locator("#profile-name");
    await page.locator('[data-step="1"] [data-next-step]').click();
    assert.equal(await categorySelect.evaluate((input) => input.validity.valueMissing), true);

    const categories = Object.entries(GARMENT_FIELDS);
    for (let index = 0; index < categories.length; index += 1) {
      const [category, expectedFields] = categories[index];
      await categorySelect.selectOption(category);
      await profileNameInput.fill(profileName);
      await page.locator('[data-step="1"] [data-next-step]').click();
      await assertVisible(page.locator('.studio-step[data-step="2"]'));
      const actualFields = await page.locator("#measurement-fields input[required]")
        .evaluateAll((inputs) => inputs.map((input) => input.name));
      assert.deepEqual(actualFields, expectedFields);
      if (index < categories.length - 1) {
        await page.locator('[data-step="2"] [data-previous-step]').click();
        await assertVisible(page.locator('.studio-step[data-step="1"]'));
      }
    }

    await page.locator('[data-step="2"] [data-previous-step]').click();
    await categorySelect.selectOption("BLOUSE");
    await profileNameInput.fill(profileName);
    await page.locator("#profile-fitting").selectOption("REGULAR");
    await page.locator('[data-step="1"] [data-next-step]').click();

    const measurementInputs = page.locator("#measurement-fields input[required]");
    await page.locator("#measurement-bust").fill("0");
    await page.locator('[data-step="2"] [data-next-step]').click();
    assert.equal(
      await page.locator("#measurement-bust").evaluate((input) => input.validity.rangeUnderflow),
      true,
      "The browser did not enforce the minimum measurement value."
    );
    for (const input of await measurementInputs.all()) {
      const name = await input.getAttribute("name");
      await input.fill(name === "bust" ? "91.44" : "60");
    }
    await page.locator("#profile-unit").selectOption("in");
    assert.equal(await page.locator("#measurement-bust").inputValue(), "36");
    await page.locator("#profile-notes").fill(`Browser test fit note ${randomBytes(4).toString("hex")}`);
    await page.locator('[data-step="2"] [data-next-step]').click();
    await assertVisible(page.locator('.studio-step[data-step="3"]'));
    assert.match(await page.locator("#measurement-review").innerText(), /36 in/);
    const saveButton = page.locator("#save-measurements");
    assert.equal(await saveButton.isDisabled(), true);
    await page.locator("#confirm-measurements").check();
    assert.equal(await saveButton.isDisabled(), false);

    const delayedSave = async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      await route.continue();
    };
    await page.route("**/api/account/measurement-profiles", delayedSave);
    const createResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/account/measurement-profiles" &&
      response.request().method() === "POST"
    );
    await saveButton.click();
    assert.equal(await saveButton.innerText(), "Saving…");
    assert.equal(await saveButton.isDisabled(), true);
    const savedResponse = await createResponse;
    await page.unroute("**/api/account/measurement-profiles", delayedSave);
    assert.equal(savedResponse.status(), 201);
    const savedBody = await savedResponse.json();
    ownerProfileId = Number(savedBody.profile.profileId);
    assert.ok(Number.isSafeInteger(ownerProfileId) && ownerProfileId > 0);
    await assertVisible(page.locator("#profile-list .studio-profile-card"));
    await verifyOwnerDatabaseState(ownerProfileId);

    const abortBookLoad = async (route) => {
      if (route.request().method() === "GET") await route.abort();
      else await route.continue();
    };
    await page.route("**/api/account/measurement-profiles", abortBookLoad);
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertVisible(page.locator("#book-error-state"));
    assert.match(
      await page.locator("#book-error-message").innerText(),
      /unable to connect to the account service/i
    );
    await page.unroute("**/api/account/measurement-profiles", abortBookLoad);
    await page.locator("#retry-book").click();
    await assertVisible(page.locator("#profile-list .studio-profile-card"));

    const customerEditedName = `RMS E2E ${randomBytes(8).toString("hex")} Customer Edit`;
    let profileCard = page.locator("#profile-list .studio-profile-card").filter({
      hasText: profileName
    });
    await profileCard.getByRole("button", { name: "Edit" }).click();
    await assertVisible(page.locator("#measurement-form"));
    await profileNameInput.fill(customerEditedName);
    await page.locator("#profile-fitting").selectOption("SNUG");
    await page.locator('[data-step="1"] [data-next-step]').click();
    await page.locator('[data-step="2"] [data-next-step]').click();
    await page.locator("#confirm-measurements").check();
    await page.locator("#save-measurements").click();
    await page.getByText("Your measurement profile has been updated.", { exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    profileCard = page.locator("#profile-list .studio-profile-card").filter({
      hasText: customerEditedName
    });
    await assertVisible(profileCard);

    owner.customerEditedName = customerEditedName;
  });

  await runStage("second customer cannot see or read the owner's profile", async () => {
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await installLocalOnlyRequests(otherContext);
    const otherPage = await otherContext.newPage();
    activePages.set("second customer", otherPage);
    await registerCustomer(otherPage, otherCustomer, true);
    await assertVisible(otherPage.locator("#book-empty-state"));
    assert.equal(
      await otherPage.locator("#profile-list .studio-profile-card").count(),
      0
    );
    const ownershipResponse = await otherPage.evaluate(async ({ base, profileId }) => {
      const response = await fetch(`${base}/api/account/measurement-profiles/${profileId}`, {
        credentials: "include"
      });
      return { status: response.status };
    }, { base: apiOrigin, profileId: ownerProfileId });
    assert.equal(ownershipResponse.status, 404);
  });

  await runStage("admin search, category filter, profile edit, attribution and customer reflection", async () => {
    const adminContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await installLocalOnlyRequests(adminContext, true);
    const adminPage = await adminContext.newPage();
    activePages.set("admin desktop", adminPage);
    await adminPage.goto(`${frontendOrigin}/admin-login.html`, {
      waitUntil: "domcontentloaded"
    });
    await adminPage.locator("#admin-username").fill(admin.username);
    await adminPage.locator("#admin-password").fill(`invalid-${randomBytes(4).toString("hex")}`);
    await adminPage.getByRole("button", { name: "Sign In" }).click();
    await adminPage.getByText("The username/email or password is incorrect.", { exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    assert.match(
      await adminPage.locator("#admin-login-message").innerText(),
      /username\/email or password is incorrect/i
    );

    await adminPage.locator("#admin-password").fill(admin.password);
    await adminPage.getByRole("button", { name: "Sign In" }).click();
    await adminPage.waitForURL(/admin-dashboard\.html/, { timeout: 15000 });
    await adminPage.locator("#admin-measurement-search").waitFor({ state: "visible" });
    const adminCookies = await adminContext.cookies(apiOrigin);
    const adminCookie = adminCookies.find((cookie) => cookie.name === "dazzle_admin_session");
    assert.ok(adminCookie && adminCookie.httpOnly && adminCookie.sameSite === "Strict");
    const tokenHash = createHash("sha256").update(adminCookie.value).digest("hex");
    const sessionConnection = await databasePool.getConnection();
    try {
      await verifyDatabaseTarget(sessionConnection);
      const [rows] = await sessionConnection.execute(
        "SELECT token_hash FROM admin_sessions WHERE admin_id = ?",
        [admin.adminId]
      );
      assert.ok(rows.some((row) => row.token_hash === tokenHash));
    } finally {
      sessionConnection.release();
    }

    const search = adminPage.locator("#admin-measurement-search");
    const filterForm = adminPage.locator("#admin-measurement-filter-form");
    await search.fill(owner.name);
    await filterForm.getByRole("button", { name: "Search" }).click();
    const resultRow = adminPage.locator("#admin-measurements-body tr").filter({
      hasText: owner.name
    });
    await assertVisible(resultRow);
    assert.match(await resultRow.innerText(), /Blouse/);

    await adminPage.locator("#admin-measurement-category").selectOption("BLOUSE");
    await filterForm.getByRole("button", { name: "Search" }).click();
    await assertVisible(resultRow);
    await search.fill(owner.customerEditedName);
    await filterForm.getByRole("button", { name: "Search" }).click();
    await assertVisible(resultRow);

    await resultRow.locator("button.admin-view-measurement").click();
    await assertVisible(adminPage.locator("#admin-measurement-detail"));
    await adminPage.locator("#admin-measurement-edit").click();
    await assertVisible(adminPage.locator("#admin-measurement-edit-form"));
    const adminEditedName = `RMS E2E ${randomBytes(8).toString("hex")} Admin Edit`;
    await adminPage.locator("#admin-measurement-profile-name").fill(adminEditedName);
    await adminPage.locator("#admin-measurement-fitting").selectOption("RELAXED");
    await adminPage.locator("#admin-measurement-notes").fill("Admin browser test update");
    await adminPage.locator("#admin-measurement-save").click();
    await adminPage.getByText("Measurement profile updated.", { exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    await search.fill(adminEditedName);
    await filterForm.getByRole("button", { name: "Search" }).click();
    await adminPage.locator("#admin-measurements-body tr")
      .filter({ hasText: adminEditedName })
      .waitFor({ state: "visible", timeout: 15000 });
    await verifyAdminAttribution(ownerProfileId);

    const ownerPage = activePages.get("customer desktop");
    await ownerPage.goto(`${frontendOrigin}/measurement-studio.html`, {
      waitUntil: "domcontentloaded"
    });
    const updatedCard = ownerPage.locator("#profile-list .studio-profile-card").filter({
      hasText: adminEditedName
    });
    await assertVisible(updatedCard);
    await updatedCard.getByRole("button", { name: "View details" }).click();
    await assertVisible(updatedCard.locator(".studio-profile-details"));
    assert.match(await updatedCard.locator(".studio-profile-details").innerText(), /RELAXED/);
    assert.match(
      await updatedCard.locator(".studio-profile-details").innerText(),
      /Admin browser test update/
    );

    await adminPage.locator("#admin-logout").click();
    await adminPage.waitForURL(/admin-login\.html/, { timeout: 15000 });
    owner.adminEditedName = adminEditedName;
  });

  await runStage("delete profile and revoke customer login", async () => {
    const page = activePages.get("customer desktop");
    const card = page.locator("#profile-list .studio-profile-card").filter({
      hasText: owner.adminEditedName
    });
    await assertVisible(card);
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Delete" }).click();
    await page.getByText("Measurement profile deleted.", { exact: true })
      .waitFor({ state: "visible", timeout: 15000 });
    await assertVisible(page.locator("#book-empty-state"));

    await page.locator(".menu-toggle").click();
    await page.locator(".menu-account-logout").click();
    await page.waitForURL(/account-login\.html/, { timeout: 15000 });
  });

  await runStage("mobile navigation and responsive layout", async () => {
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    await installLocalOnlyRequests(mobileContext);
    const mobilePage = await mobileContext.newPage();
    activePages.set("mobile viewport 390x844", mobilePage);
    await mobilePage.goto(`${frontendOrigin}/index.html`, { waitUntil: "domcontentloaded" });
    const menuLink = mobilePage.locator(
      '#menu-panel a[data-page="measurement-studio"]'
    );
    await menuLink.waitFor({ state: "attached", timeout: 15000 });
    await mobilePage.locator(".menu-toggle").click();
    assert.equal(await mobilePage.locator(".menu-toggle").getAttribute("aria-expanded"), "true");
    await menuLink.click();
    await mobilePage.waitForURL(/measurement-studio\.html/, { timeout: 15000 });
    assert.equal(await mobilePage.locator(".menu-toggle").getAttribute("aria-expanded"), "false");
    await assertVisible(mobilePage.locator("#studio-auth-notice"));
    assert.equal(await mobilePage.locator(".studio-guide-card").count(), 9);
    await assertNoHorizontalOverflow(mobilePage);
    await mobilePage.locator("#studio-register-link").click();
    await assertVisible(mobilePage.locator("#account-register-form"));
    await assertNoHorizontalOverflow(mobilePage);
  });

  await context.close();
}

async function cleanupTestData() {
  if (!preflightPassed || !databasePool) {
    cleanupStatus = "not run (safety preflight did not pass; no test writes were attempted)";
    return;
  }

  let connection;
  let transaction = false;
  try {
    connection = await databasePool.getConnection();
    await verifyDatabaseTarget(connection);
    await connection.beginTransaction();
    transaction = true;

    for (const identity of [owner, otherCustomer].filter(Boolean)) {
      const [rows] = await connection.execute(
        `SELECT customer_id, name, phone, email
         FROM customers
         WHERE email = ? AND phone = ?
         FOR UPDATE`,
        [identity.email, identity.phone]
      );
      if (rows.length > 1) {
        throw makeBrowserFailure("CleanupSafetyError", "Multiple exact synthetic customer matches.");
      }
      if (!rows.length) continue;
      const row = rows[0];
      if (row.name !== identity.name || row.email !== identity.email || row.phone !== identity.phone) {
        throw makeBrowserFailure("CleanupSafetyError", "A synthetic customer identity changed.");
      }
      const [result] = await connection.execute(
        `DELETE FROM customers
         WHERE customer_id = ? AND name = ? AND phone = ? AND email = ?`,
        [row.customer_id, identity.name, identity.phone, identity.email]
      );
      if (result.affectedRows !== 1) {
        throw makeBrowserFailure("CleanupSafetyError", "An exact synthetic customer was not deleted.");
      }
    }

    if (adminCreated && admin && Number.isSafeInteger(admin.adminId)) {
      const [rows] = await connection.execute(
        "SELECT admin_id, username FROM admin_users WHERE admin_id = ? FOR UPDATE",
        [admin.adminId]
      );
      if (rows.length > 1 || (rows.length === 1 && rows[0].username !== admin.username)) {
        throw makeBrowserFailure("CleanupSafetyError", "The synthetic admin identity changed.");
      }
      if (rows.length === 1) {
        const [result] = await connection.execute(
          "DELETE FROM admin_users WHERE admin_id = ? AND username = ?",
          [admin.adminId, admin.username]
        );
        if (result.affectedRows !== 1) {
          throw makeBrowserFailure("CleanupSafetyError", "The exact synthetic admin was not deleted.");
        }
      }
    }

    await connection.commit();
    transaction = false;
    connection.release();
    connection = null;

    const verification = await mysql.createConnection(databaseConnectionOptions(directConfig));
    try {
      await verifyDatabaseTarget(verification);
      const counts = await readTableCounts(verification);
      if (Object.values(counts).some((count) => count !== 0)) {
        cleanupStatus = `FAILED; remaining rows ${JSON.stringify(counts)}`;
      } else {
        cleanupStatus = "verified; all six integration tables contain zero rows";
      }
    } finally {
      await verification.end();
    }
  } catch (error) {
    if (transaction && connection) {
      try {
        await connection.rollback();
        transaction = false;
      } catch {
        cleanupStatus = "FAILED; cleanup rollback could not be confirmed";
      }
    }
    if (cleanupStatus === "not run (safety preflight did not pass)") {
      cleanupStatus = `FAILED; ${safeFailure(error)}`;
    }
  } finally {
    if (connection) {
      try {
        connection.release();
      } catch {
        cleanupStatus = "FAILED; cleanup connection could not be released";
      }
    }
  }
}

async function main() {
  try {
    directConfig = readTestDatabaseConfig();
    const preflightConnection = await mysql.createConnection(
      databaseConnectionOptions(directConfig)
    );
    try {
      const target = await verifySafeEmptyDatabase(preflightConnection);
      console.log(
        `Safety verified: ${target.database}, TiDB ${target.serverVersion}, ` +
        `global/session ${target.globalMode}, TLS identity verified.`
      );
    } finally {
      await preflightConnection.end();
    }

    applyTestDatabaseEnvironment(directConfig);
    databasePool = require("./database").pool;
    const appTarget = await verifyApplicationPool();
    assert.equal(appTarget.database, "dazzle_boutique_test");
    preflightPassed = true;
    const nonce = randomBytes(8).toString("hex");
    owner = createCustomerIdentity("owner", nonce);
    otherCustomer = createCustomerIdentity("other", nonce);
    admin = createAdminIdentity(nonce);

    const createdAdmin = await createAdminAccount(
      databasePool,
      admin.username,
      admin.password
    );
    adminCreated = true;
    admin.adminId = Number(createdAdmin.adminId);
    assert.ok(Number.isSafeInteger(admin.adminId) && admin.adminId > 0);

    await startApplicationServers();
    browser = await chromium.launch({ headless: true });
    console.log("Browser servers bound to loopback; browser requests are restricted to those local origins.");

    await runBrowserJourneys();
  } catch (error) {
    if (!failureLogged) {
      RESULT.failed += 1;
      failureLogged = true;
      console.error(`[FAIL] browser: ${activeStage} — ${safeFailure(error)}`);
      await captureFailureScreenshots(activeStage);
    }
  } finally {
    for (const page of activePages.values()) {
      if (!page.isClosed()) {
        try {
          await page.close();
        } catch {
          console.error("Could not close a browser page.");
        }
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch {
        console.error("Could not close Chromium.");
      }
    }
    for (const server of [apiServer, staticServer]) {
      try {
        await closeServer(server);
      } catch {
        console.error("Could not close a loopback test server.");
      }
    }

    await cleanupTestData();
    if (databasePool) {
      try {
        await databasePool.end();
      } catch {
        cleanupStatus = "FAILED; database pool could not be closed";
      }
    }

    console.log(`Browser tests: ${RESULT.passed} passed, ${RESULT.failed} failed.`);
    console.log(`Cleanup: ${cleanupStatus}.`);
    if (RESULT.failed > 0 || !cleanupStatus.startsWith("verified;")) {
      process.exitCode = 1;
    }
  }
}

main().catch(() => {
  console.error("[FAIL] browser harness terminated unexpectedly; sensitive details suppressed.");
  process.exitCode = 1;
});
