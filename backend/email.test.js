const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getSmtpConfiguration,
  getBrevoConfiguration,
  isSmtpConfigured,
  isEmailConfigured,
  sendCustomerPasswordResetEmail,
  sendCustomerLoginNotification,
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail
} = require("./email");

const smtpEnvironment = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USERNAME: "mailer-user",
  SMTP_PASSWORD: "mailer-password",
  SMTP_FROM: "Dazzle Boutique <no-reply@example.com>",
  FRONTEND_BASE_URL: "https://shop.example.com/frontend/"
};

test("SMTP configuration requires all connection and sender settings", () => {
  assert.equal(isSmtpConfigured({}), false);
  assert.equal(getSmtpConfiguration({ ...smtpEnvironment, SMTP_PORT: "invalid" }), null);
  assert.equal(getSmtpConfiguration({ ...smtpEnvironment, FRONTEND_BASE_URL: "javascript:alert(1)" }), null);
  assert.equal(isSmtpConfigured(smtpEnvironment), true);
});

test("password reset email uses configured SMTP and sends the token only in the reset link", async () => {
  let transportOptions;
  let message;
  const token = "A".repeat(43);
  await sendCustomerPasswordResetEmail(
    { email: "customer@example.com", token },
    smtpEnvironment,
    (options) => {
      transportOptions = options;
      return {
        async sendMail(mail) {
          message = mail;
        }
      };
    }
  );

  assert.equal(transportOptions.host, smtpEnvironment.SMTP_HOST);
  assert.equal(transportOptions.port, 587);
  assert.equal(transportOptions.secure, false);
  assert.equal(transportOptions.auth.pass, smtpEnvironment.SMTP_PASSWORD);
  assert.equal(message.to, "customer@example.com");
  assert.equal(message.from, smtpEnvironment.SMTP_FROM);
  assert.match(message.text, new RegExp(`token=${token}`));
});

test("SMTP delivery errors are propagated for safe handling by the caller", async () => {
  await assert.rejects(
    sendCustomerPasswordResetEmail(
      { email: "customer@example.com", token: "A".repeat(43) },
      smtpEnvironment,
      () => ({
        async sendMail() {
          const error = new Error("SMTP unavailable");
          error.code = "ECONNECTION";
          throw error;
        }
      })
    ),
    (error) => error.code === "ECONNECTION"
  );

  await assert.rejects(
    sendCustomerPasswordResetEmail(
      { email: "customer@example.com", token: "A".repeat(43) },
      {}
    ),
    (error) => error.code === "SMTP_NOT_CONFIGURED"
  );
});

test("customer login notification contains only the successful login time", async () => {
  let message;
  await sendCustomerLoginNotification({
    email: "customer@example.com",
    loginAt: "2026-03-20T12:34:56.000Z"
  }, smtpEnvironment, () => ({
    async sendMail(mail) {
      message = mail;
    }
  }));

  assert.equal(message.to, "customer@example.com");
  assert.match(message.text, /2026-03-20T12:34:56\.000Z \(UTC\)/);
  assert.doesNotMatch(message.text, /dazzle-pass|session[_ -]?token|reset[_ -]?token/i);
});

test("order notification emails include order and item summaries", async () => {
  const messages = [];
  const createTransport = () => ({
    async sendMail(message) {
      messages.push(message);
    }
  });
  const order = {
    orderNumber: "DB-0123456789abcdef01234567",
    orderStatus: "Order Placed",
    totalAmount: 1499,
    paymentMethod: "COD",
    items: [{
      productName: "Meera Floral Kurti",
      size: "M",
      quantity: 1,
      subtotal: 1499
    }]
  };

  await sendOrderConfirmationEmail({
    email: "customer@example.com",
    order
  }, smtpEnvironment, createTransport);
  await sendOrderStatusUpdateEmail({
    email: "customer@example.com",
    order: { ...order, previousStatus: "Shipped", orderStatus: "Delivered" }
  }, smtpEnvironment, createTransport);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].to, "customer@example.com");
  assert.match(messages[0].subject, /DB-0123456789abcdef01234567/);
  assert.match(messages[0].text, /Order number: DB-0123456789abcdef01234567/);
  assert.match(messages[0].text, /Status: Order Placed/);
  assert.match(messages[0].text, /Meera Floral Kurti, size M, quantity 1, subtotal INR 1499\.00/);
  assert.match(messages[1].text, /Previous status: Shipped/);
  assert.match(messages[1].text, /Status: Delivered/);
});


const brevoEnvironment = {
  BREVO_API_KEY: "test-brevo-api-key",
  BREVO_SENDER_EMAIL: "verified@example.com",
  BREVO_SENDER_NAME: "Dazzle the Sister's Boutique",
  FRONTEND_BASE_URL: "https://shop.example.com/frontend/"
};

test("Brevo configuration is accepted for HTTPS email delivery", () => {
  assert.equal(isEmailConfigured(brevoEnvironment), true);
  assert.equal(isEmailConfigured({ ...brevoEnvironment, BREVO_API_KEY: "" }), false);
  assert.equal(getBrevoConfiguration(brevoEnvironment).sender.email, "verified@example.com");
});

test("Brevo sends password reset email through the HTTPS API", async () => {
  let request;
  await sendCustomerPasswordResetEmail(
    { email: "customer@example.com", token: "A".repeat(43) },
    brevoEnvironment,
    undefined,
    async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, async json() { return { messageId: "test-message-id" }; } };
    }
  );
  assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["api-key"], brevoEnvironment.BREVO_API_KEY);
  assert.equal(request.body.sender.email, brevoEnvironment.BREVO_SENDER_EMAIL);
  assert.equal(request.body.to[0].email, "customer@example.com");
  assert.match(request.body.textContent, /reset-password\.html#token=/);
});

test("Brevo API errors are reported with their HTTP status", async () => {
  await assert.rejects(
    sendCustomerLoginNotification(
      { email: "customer@example.com", loginAt: "2026-03-20T12:34:56.000Z" },
      brevoEnvironment,
      undefined,
      async () => ({ ok: false, status: 401, async text() { return "unauthorized"; } })
    ),
    (error) => error.code === "BREVO_HTTP_401"
  );
});
