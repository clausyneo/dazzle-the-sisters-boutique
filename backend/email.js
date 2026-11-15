const nodemailer = require("nodemailer");

function getSmtpConfiguration(environment = process.env) {
  const host = environment.SMTP_HOST?.trim();
  const port = Number(environment.SMTP_PORT);
  const username = environment.SMTP_USERNAME?.trim();
  const password = environment.SMTP_PASSWORD;
  const from = environment.SMTP_FROM?.trim();
  const frontendBaseUrl = environment.FRONTEND_BASE_URL?.trim();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !username || !password || !from || !frontendBaseUrl) {
    return null;
  }
  let baseUrl;
  try {
    baseUrl = new URL(frontendBaseUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(baseUrl.protocol)) return null;
  return { host, port, username, password, from, frontendBaseUrl };
}

function isSmtpConfigured(environment = process.env) {
  return getSmtpConfiguration(environment) !== null;
}

function requireSmtpConfiguration(environment) {
  const configuration = getSmtpConfiguration(environment);
  if (!configuration) {
    const error = new Error("SMTP is not configured.");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }
  return configuration;
}

async function sendEmailMessage(configuration, message, createTransport) {
  const transporter = createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.port === 465,
    auth: {
      user: configuration.username,
      pass: configuration.password
    }
  });
  await transporter.sendMail({
    from: configuration.from,
    ...message
  });
}

async function sendCustomerPasswordResetEmail(
  { email, token },
  environment = process.env,
  createTransport = nodemailer.createTransport
) {
  const configuration = requireSmtpConfiguration(environment);
  const resetUrl = new URL("reset-password.html", `${configuration.frontendBaseUrl.replace(/\/+$/, "")}/`);
  resetUrl.hash = new URLSearchParams({ token }).toString();
  await sendEmailMessage(configuration, {
    to: email,
    subject: "Reset your Dazzle Boutique password",
    text: `Use this link within 30 minutes to reset your password:\n\n${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Use this link within 30 minutes to reset your password:</p><p><a href="${resetUrl.toString()}">Reset your Dazzle Boutique password</a></p><p>If you did not request this, you can ignore this email.</p>`
  }, createTransport);
}

async function sendCustomerLoginNotification(
  { email, loginAt },
  environment = process.env,
  createTransport = nodemailer.createTransport
) {
  const configuration = requireSmtpConfiguration(environment);
  const timestamp = new Date(loginAt).toISOString();
  await sendEmailMessage(configuration, {
    to: email,
    subject: "New sign-in to your Dazzle Boutique account",
    text: `A successful sign-in to your Dazzle Boutique account occurred at ${timestamp} (UTC).\n\nIf this was not you, reset your password or contact the boutique.`
  }, createTransport);
}

function formatOrderSummary(order) {
  const items = (order.items || []).map((item) =>
    `- ${item.productName}, size ${item.size}, quantity ${item.quantity}, subtotal INR ${Number(item.subtotal).toFixed(2)}`
  );
  const lines = [
    `Order number: ${order.orderNumber}`,
    `Status: ${order.orderStatus}`,
    order.previousStatus ? `Previous status: ${order.previousStatus}` : null,
    `Total: INR ${Number(order.totalAmount).toFixed(2)}`,
    `Payment method: ${order.paymentMethod}`,
    "Items:",
    ...(items.length ? items : ["- Item details unavailable."])
  ];
  return lines.filter(Boolean).join("\n");
}

async function sendOrderConfirmationEmail(
  { email, order },
  environment = process.env,
  createTransport = nodemailer.createTransport
) {
  const configuration = requireSmtpConfiguration(environment);
  await sendEmailMessage(configuration, {
    to: email,
    subject: `Order ${order.orderNumber} confirmation`,
    text: `Thank you for your order from Dazzle Boutique.\n\n${formatOrderSummary(order)}`
  }, createTransport);
}

async function sendOrderStatusUpdateEmail(
  { email, order },
  environment = process.env,
  createTransport = nodemailer.createTransport
) {
  const configuration = requireSmtpConfiguration(environment);
  await sendEmailMessage(configuration, {
    to: email,
    subject: `Order ${order.orderNumber} status update`,
    text: `Your Dazzle Boutique order status has changed.\n\n${formatOrderSummary(order)}`
  }, createTransport);
}

module.exports = {
  getSmtpConfiguration,
  isSmtpConfigured,
  sendCustomerPasswordResetEmail,
  sendCustomerLoginNotification,
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail
};
