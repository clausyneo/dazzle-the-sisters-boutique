const ADMIN_API_URL = "http://127.0.0.1:3000";
const ADMIN_ORDER_STATUSES = [
  "Order Placed",
  "Confirmed",
  "Processing",
  "Ready for Dispatch",
  "Shipped",
  "Delivered",
  "Cancelled"
];
const ADMIN_NEXT_STATUS = new Map([
  ["Order Placed", "Confirmed"],
  ["Confirmed", "Processing"],
  ["Processing", "Ready for Dispatch"],
  ["Ready for Dispatch", "Shipped"],
  ["Shipped", "Delivered"]
]);
const ADMIN_CANCELLABLE = new Set([
  "Order Placed",
  "Confirmed",
  "Processing",
  "Ready for Dispatch"
]);

async function adminApi(path, options = {}) {
  const response = await fetch(`${ADMIN_API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }
  if (!response.ok || !result.success) {
    const error = new Error(result.message || "The admin request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function setAdminMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function formatAdminMoney(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(amount));
}

function formatAdminDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function makeAdminCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
  return cell;
}

async function initializeAdminLogin() {
  const form = document.querySelector("#admin-login-form");
  if (!form) return;
  try {
    await adminApi("/api/admin/me");
    window.location.replace("admin-dashboard.html");
    return;
  } catch (error) {
    if (error.status !== 401) {
      setAdminMessage(document.querySelector("#admin-login-message"), error.message, true);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#admin-login-message");
    const submit = form.querySelector("button[type=submit]");
    const values = new FormData(form);
    submit.disabled = true;
    setAdminMessage(message, "Signing in…");
    try {
      await adminApi("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          username: values.get("username"),
          password: values.get("password")
        })
      });
      form.reset();
      window.location.replace("admin-dashboard.html");
    } catch (error) {
      setAdminMessage(message, error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

function availableNextStatuses(currentStatus) {
  const statuses = [];
  const nextStatus = ADMIN_NEXT_STATUS.get(currentStatus);
  if (nextStatus) statuses.push(nextStatus);
  if (ADMIN_CANCELLABLE.has(currentStatus)) statuses.push("Cancelled");
  return statuses;
}

function addDetailLine(container, label, value) {
  const line = document.createElement("p");
  const title = document.createElement("strong");
  title.textContent = `${label}: `;
  line.append(title, document.createTextNode(value || "Not provided"));
  container.append(line);
}

async function initializeAdminDashboard() {
  const ordersBody = document.querySelector("#admin-orders-body");
  if (!ordersBody) return;
  const message = document.querySelector("#admin-message");
  const ordersMessage = document.querySelector("#admin-orders-message");
  const detailMessage = document.querySelector("#admin-detail-message");
  const filterForm = document.querySelector("#admin-filter-form");
  const orderDetail = document.querySelector("#admin-order-detail");
  const detailContent = document.querySelector("#admin-detail-content");
  const itemBody = document.querySelector("#admin-items-body");
  const statusForm = document.querySelector("#admin-status-form");
  const statusSelect = document.querySelector("#admin-new-status");
  const saveStatusButton = statusForm.querySelector("button[type=submit]");
  const recordPaymentButton = document.querySelector("#admin-record-cod-payment");
  const markDeliveredButton = document.querySelector("#admin-mark-delivered");
  let currentPage = 1;
  let totalPages = 1;
  let selectedOrderId = null;
  let selectedOrderStatus = null;
  let selectedOrder = null;
  let statusUpdatePending = false;
  let recordPaymentPending = false;

  try {
    const result = await adminApi("/api/admin/me");
    document.querySelector("#admin-identity").textContent = result.admin.username;
  } catch (error) {
    if (error.status === 401) {
      window.location.replace("admin-login.html");
      return;
    }
    setAdminMessage(message, error.message, true);
    return;
  }

  async function loadSummary() {
    try {
      const { summary } = await adminApi("/api/admin/dashboard");
      document.querySelector("#summary-total").textContent = summary.totalOrders.toLocaleString("en-IN");
      document.querySelector("#summary-pending").textContent = summary.pendingOrders.toLocaleString("en-IN");
      document.querySelector("#summary-completed").textContent = summary.completedOrders.toLocaleString("en-IN");
      document.querySelector("#summary-value").textContent = formatAdminMoney(summary.orderValue);
    } catch (error) {
      setAdminMessage(message, error.message, true);
    }
  }

  async function loadOrders(page = currentPage) {
    const query = new URLSearchParams(new FormData(filterForm));
    query.set("page", String(page));
    query.set("pageSize", "20");
    ordersBody.replaceChildren();
    setAdminMessage(ordersMessage, "Loading orders…");
    try {
      const result = await adminApi(`/api/admin/orders?${query.toString()}`);
      currentPage = result.pagination.page;
      totalPages = Math.max(1, result.pagination.totalPages);
      if (result.orders.length === 0) {
        setAdminMessage(ordersMessage, "No orders match these filters.");
      } else {
        setAdminMessage(ordersMessage, `${result.pagination.total} order(s) found.`);
      }

      for (const order of result.orders) {
        const row = document.createElement("tr");
        makeAdminCell(row, order.orderNumber);
        makeAdminCell(row, order.customerName);
        makeAdminCell(row, formatAdminDate(order.orderDate));
        makeAdminCell(row, formatAdminMoney(order.totalAmount));
        makeAdminCell(row, order.paymentMethod);
        makeAdminCell(row, order.paymentStatus);
        makeAdminCell(row, order.orderStatus);
        const actionCell = document.createElement("td");
        const button = document.createElement("button");
        button.className = "text-link admin-view-order";
        button.type = "button";
        button.textContent = "View";
        button.addEventListener("click", () => loadOrderDetails(order.orderId));
        actionCell.append(button);
        row.append(actionCell);
        ordersBody.append(row);
      }

      document.querySelector("#admin-page-label").textContent =
        `Page ${currentPage} of ${totalPages}`;
      document.querySelector("#admin-previous-page").disabled = currentPage <= 1;
      document.querySelector("#admin-next-page").disabled = currentPage >= totalPages;
    } catch (error) {
      setAdminMessage(ordersMessage, error.message, true);
      document.querySelector("#admin-page-label").textContent = `Page ${page}`;
    }
  }

  function syncRecordPaymentButton(order) {
    if (!order || !selectedOrderId) {
      recordPaymentButton.hidden = true;
      recordPaymentButton.disabled = true;
      return;
    }

    const canRecordPayment = order.paymentMethod === "COD" && order.paymentStatus === "Pending";
    recordPaymentButton.hidden = !canRecordPayment;
    recordPaymentButton.disabled = recordPaymentPending || !canRecordPayment;
    recordPaymentButton.textContent = recordPaymentPending ? "Recording payment…" : "Record COD Payment";
  }

  async function loadOrderDetails(orderId) {
    selectedOrderId = orderId;
    setAdminMessage(detailMessage, "Loading order details…");
    detailContent.replaceChildren();
    itemBody.replaceChildren();
    orderDetail.hidden = false;
    try {
      const { order } = await adminApi(`/api/admin/orders/${encodeURIComponent(orderId)}`);
      selectedOrder = order;
      selectedOrderStatus = order.orderStatus;
      document.querySelector("#admin-detail-title").textContent = order.orderNumber;
      const customerSection = document.createElement("section");
      customerSection.className = "admin-detail-block";
      const customerHeading = document.createElement("h3");
      customerHeading.textContent = "Customer and delivery";
      customerSection.append(customerHeading);
      addDetailLine(customerSection, "Name", order.customer.name);
      addDetailLine(customerSection, "Mobile", order.customer.phone);
      addDetailLine(customerSection, "Email", order.customer.email);
      addDetailLine(customerSection, "Address", order.customer.address);
      addDetailLine(customerSection, "City", order.customer.city);
      addDetailLine(customerSection, "PIN code", order.customer.pinCode);

      const orderSection = document.createElement("section");
      orderSection.className = "admin-detail-block";
      const orderHeading = document.createElement("h3");
      orderHeading.textContent = "Order";
      orderSection.append(orderHeading);
      addDetailLine(orderSection, "Date", formatAdminDate(order.orderDate));
      addDetailLine(orderSection, "Status", order.orderStatus);
      addDetailLine(orderSection, "Payment", order.paymentMethod);
      addDetailLine(orderSection, "Payment status", order.paymentStatus);
      addDetailLine(orderSection, "Total", formatAdminMoney(order.totalAmount));
      detailContent.append(customerSection, orderSection);

      for (const item of order.items) {
        const row = document.createElement("tr");
        makeAdminCell(row, item.productName);
        makeAdminCell(row, item.size);
        makeAdminCell(row, String(item.quantity));
        makeAdminCell(row, formatAdminMoney(item.unitPrice));
        makeAdminCell(row, formatAdminMoney(item.subtotal));
        itemBody.append(row);
      }

      statusSelect.replaceChildren();
      const currentOption = document.createElement("option");
      currentOption.value = order.orderStatus;
      currentOption.textContent = order.orderStatus;
      statusSelect.append(currentOption);
      for (const status of availableNextStatuses(order.orderStatus)) {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        statusSelect.append(option);
      }
      const canChange = availableNextStatuses(order.orderStatus).length > 0;
      statusSelect.disabled = !canChange || statusUpdatePending;
      saveStatusButton.disabled = !canChange || statusUpdatePending;
      markDeliveredButton.hidden = order.orderStatus !== "Shipped";
      markDeliveredButton.disabled = order.orderStatus !== "Shipped" || statusUpdatePending;
      syncRecordPaymentButton(order);
      setAdminMessage(detailMessage, "");
      orderDetail.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    } catch (error) {
      selectedOrder = null;
      setAdminMessage(detailMessage, error.message, true);
      return false;
    }
  }

  async function updateSelectedOrderStatus(requestedStatus, successMessage) {
    if (statusUpdatePending || !selectedOrderId || !selectedOrderStatus) return;
    const orderId = selectedOrderId;
    statusUpdatePending = true;
    statusSelect.disabled = true;
    saveStatusButton.disabled = true;
    markDeliveredButton.disabled = true;
    setAdminMessage(detailMessage, "Updating order status…");

    try {
      const result = await adminApi(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ orderStatus: requestedStatus })
      });
      selectedOrderStatus = result.order.orderStatus;
      const detailRefreshed = selectedOrderId !== orderId || await loadOrderDetails(orderId);
      await Promise.all([loadOrders(), loadSummary()]);
      if (selectedOrderId === orderId) {
        setAdminMessage(
          detailMessage,
          detailRefreshed
            ? successMessage
            : `${successMessage} The refreshed order details could not be loaded.`,
          !detailRefreshed
        );
      } else {
        setAdminMessage(message, successMessage);
      }
    } catch (error) {
      setAdminMessage(
        selectedOrderId === orderId ? detailMessage : message,
        error.message,
        true
      );
    } finally {
      statusUpdatePending = false;
      const canChange = availableNextStatuses(selectedOrderStatus).length > 0;
      statusSelect.disabled = !canChange;
      saveStatusButton.disabled = !canChange;
      markDeliveredButton.hidden = selectedOrderStatus !== "Shipped";
      markDeliveredButton.disabled = selectedOrderStatus !== "Shipped";
    }
  }

  document.querySelector("#admin-logout").addEventListener("click", async () => {
    try {
      await adminApi("/api/admin/logout", { method: "POST" });
    } catch (error) {
      setAdminMessage(message, error.message, true);
      return;
    }
    window.location.replace("admin-login.html");
  });
  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadOrders(1);
  });
  document.querySelector("#admin-clear-filters").addEventListener("click", () => {
    filterForm.reset();
    loadOrders(1);
  });
  document.querySelector("#admin-previous-page").addEventListener("click", () => {
    if (currentPage > 1) loadOrders(currentPage - 1);
  });
  document.querySelector("#admin-next-page").addEventListener("click", () => {
    if (currentPage < totalPages) loadOrders(currentPage + 1);
  });
  document.querySelector("#admin-close-detail").addEventListener("click", () => {
    orderDetail.hidden = true;
    selectedOrderId = null;
    selectedOrderStatus = null;
    selectedOrder = null;
    syncRecordPaymentButton(null);
  });
  statusForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await updateSelectedOrderStatus(statusSelect.value, "Order status updated.");
  });
  recordPaymentButton.addEventListener("click", async () => {
    if (recordPaymentPending || !selectedOrderId || !selectedOrder) return;

    const canRecordPayment = selectedOrder.paymentMethod === "COD" && selectedOrder.paymentStatus === "Pending";
    if (!canRecordPayment) {
      syncRecordPaymentButton(selectedOrder);
      return;
    }

    const totalText = formatAdminMoney(selectedOrder.totalAmount);
    const confirmed = window.confirm(
      `Confirm receipt of the full COD amount for this order: ${totalText}. This action records payment as received and cannot be repeated once recorded.`
    );
    if (!confirmed) {
      setAdminMessage(detailMessage, "COD payment recording cancelled. No payment was recorded.");
      return;
    }

    recordPaymentPending = true;
    syncRecordPaymentButton(selectedOrder);
    setAdminMessage(detailMessage, "Recording COD payment…");

    try {
      await adminApi(`/api/admin/orders/${encodeURIComponent(selectedOrderId)}/payment-status`, {
        method: "PATCH"
      });
      const refreshed = await loadOrderDetails(selectedOrderId);
      await Promise.all([loadOrders(), loadSummary()]);
      setAdminMessage(
        detailMessage,
        refreshed
          ? `COD payment recorded successfully. The order payment status is now Paid.`
          : "COD payment recorded successfully, but the refreshed order details could not be loaded.",
        !refreshed
      );
    } catch (error) {
      setAdminMessage(detailMessage, error.message, true);
    } finally {
      recordPaymentPending = false;
      syncRecordPaymentButton(selectedOrder);
    }
  });

  markDeliveredButton.addEventListener("click", async () => {
    if (statusUpdatePending || selectedOrderStatus !== "Shipped") return;
    if (!window.confirm("Confirm that this order has actually been delivered?")) {
      setAdminMessage(detailMessage, "Delivery confirmation cancelled. The order was not updated.");
      return;
    }
    await updateSelectedOrderStatus("Delivered", "Order marked as delivered.");
  });

  const statusFilter = document.querySelector("#admin-status-filter");
  for (const status of ADMIN_ORDER_STATUSES) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    statusFilter.append(option);
  }
  await Promise.all([loadSummary(), loadOrders(1)]);
}

initializeAdminLogin();
initializeAdminDashboard();
