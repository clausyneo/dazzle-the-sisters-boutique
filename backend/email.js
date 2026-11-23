const nodemailer = require("nodemailer");

function getSmtpConfiguration(env = process.env) {
  const host = env.SMTP_HOST?.trim();
  const port = Number(env.SMTP_PORT);
  const username = env.SMTP_USERNAME?.trim();
  const password = env.SMTP_PASSWORD;
  const from = env.SMTP_FROM?.trim();
  const frontendBaseUrl = env.FRONTEND_BASE_URL?.trim();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password || !from || !frontendBaseUrl) return null;
  try { if (!["http:", "https:"].includes(new URL(frontendBaseUrl).protocol)) return null; } catch { return null; }
  return { provider: "smtp", host, port, username, password, from, frontendBaseUrl };
}

function getBrevoConfiguration(env = process.env) {
  const apiKey = env.BREVO_API_KEY?.trim();
  const senderEmail = env.BREVO_SENDER_EMAIL?.trim();
  const senderName = env.BREVO_SENDER_NAME?.trim();
  const frontendBaseUrl = env.FRONTEND_BASE_URL?.trim();
  if (!apiKey || !senderEmail || !senderName || !frontendBaseUrl) return null;
  try { if (!["http:", "https:"].includes(new URL(frontendBaseUrl).protocol)) return null; } catch { return null; }
  return { provider: "brevo", apiKey, sender: { email: senderEmail, name: senderName }, frontendBaseUrl };
}

function isSmtpConfigured(env = process.env) {
  return getSmtpConfiguration(env) !== null;
}

function isEmailConfigured(env = process.env) {
  return Boolean(getBrevoConfiguration(env) || getSmtpConfiguration(env));
}

function requireEmailConfiguration(env) {
  const config = getBrevoConfiguration(env) || getSmtpConfiguration(env);
  if (!config) {
    const error = new Error("Email delivery is not configured.");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }
  return config;
}

async function sendEmailMessage(config, message, createTransport, fetchImpl = globalThis.fetch) {
  if (config.provider === "brevo") {
    const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "api-key": config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        sender: config.sender,
        to: [{ email: message.to }],
        subject: message.subject,
        ...(message.html ? { htmlContent: message.html } : { textContent: message.text })
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      const error = new Error(`Brevo email request failed with HTTP ${response.status}.`);
      error.code = `BREVO_HTTP_${response.status}`;
      error.providerMessage = details.slice(0, 500);
      throw error;
    }
    return response.json().catch(() => ({}));
  }
  const transporter = createTransport({
    host: config.host, port: config.port, secure: config.port === 465,
    auth: { user: config.username, pass: config.password }
  });
  return transporter.sendMail({ from: config.from, ...message });
}

function resetUrl(config, token) {
  const url = new URL("reset-password.html", `${config.frontendBaseUrl.replace(/\/+$/, "")}/`);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

async function sendCustomerPasswordResetEmail({ email, token }, env = process.env, createTransport = nodemailer.createTransport, fetchImpl = globalThis.fetch) {
  const config = requireEmailConfiguration(env);
  const link = resetUrl(config, token);
  return sendEmailMessage(config, {
    to: email, subject: "Reset your Dazzle Boutique password",
    text: `Use this link within 30 minutes to reset your password:\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Use this link within 30 minutes to reset your password:</p><p><a href="${link}">Reset your Dazzle Boutique password</a></p><p>If you did not request this, you can ignore this email.</p>`
  }, createTransport, fetchImpl);
}

async function sendCustomerLoginNotification({ email, loginAt }, env = process.env, createTransport = nodemailer.createTransport, fetchImpl = globalThis.fetch) {
  const config = requireEmailConfiguration(env);
  const timestamp = new Date(loginAt).toISOString();
  return sendEmailMessage(config, {
    to: email, subject: "New sign-in to your Dazzle Boutique account",
    text: `A successful sign-in to your Dazzle Boutique account occurred at ${timestamp} (UTC).\n\nIf this was not you, reset your password or contact the boutique.`
  }, createTransport, fetchImpl);
}

function formatOrderSummary(order) {
  const items = (order.items || []).map(item => `- ${item.productName}, size ${item.size}, quantity ${item.quantity}, subtotal INR ${Number(item.subtotal).toFixed(2)}`);
  return [
    `Order number: ${order.orderNumber}`, `Status: ${order.orderStatus}`,
    order.previousStatus ? `Previous status: ${order.previousStatus}` : null,
    `Total: INR ${Number(order.totalAmount).toFixed(2)}`, `Payment method: ${order.paymentMethod}`,
    "Items:", ...(items.length ? items : ["- Item details unavailable."])
  ].filter(Boolean).join("\n");
}

async function sendOrderConfirmationEmail({ email, order }, env = process.env, createTransport = nodemailer.createTransport, fetchImpl = globalThis.fetch) {
  const config = requireEmailConfiguration(env);
  return sendEmailMessage(config, {
    to: email, subject: `Order ${order.orderNumber} confirmation`,
    text: `Thank you for your order from Dazzle Boutique.\n\n${formatOrderSummary(order)}`
  }, createTransport, fetchImpl);
}

async function sendOrderStatusUpdateEmail({ email, order }, env = process.env, createTransport = nodemailer.createTransport, fetchImpl = globalThis.fetch) {
  const config = requireEmailConfiguration(env);
  return sendEmailMessage(config, {
    to: email, subject: `Order ${order.orderNumber} status update`,
    text: `Your Dazzle Boutique order status has changed.\n\n${formatOrderSummary(order)}`
  }, createTransport, fetchImpl);
}

module.exports = {
  getSmtpConfiguration, getBrevoConfiguration, isSmtpConfigured, isEmailConfigured,
  sendCustomerPasswordResetEmail, sendCustomerLoginNotification,
  sendOrderConfirmationEmail, sendOrderStatusUpdateEmail
};
