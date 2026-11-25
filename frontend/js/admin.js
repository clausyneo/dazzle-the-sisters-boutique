const ADMIN_API_URL = window.DAZZLE_CONFIG.API_BASE_URL;
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
const ADMIN_GARMENT_LABELS = {
  BLOUSE: "Blouse",
  SUIT_SALWAR_KAMEEZ: "Suit / Salwar Kameez",
  LEHENGA: "Lehenga",
  KURTI: "Kurti",
  PANTS_PALAZZO: "Pants / Palazzo",
  ANARKALI_GOWN: "Anarkali / Gown"
};
const ADMIN_MEASUREMENT_FIELDS = {
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
  KURTI: [
    "bust", "waist", "hip", "shoulder", "armhole", "sleeve_length", "kurti_length"
  ],
  PANTS_PALAZZO: ["waist", "hip", "thigh", "inseam", "outseam", "ankle_opening"],
  ANARKALI_GOWN: [
    "bust", "waist", "hip", "shoulder", "armhole", "sleeve_length", "gown_length"
  ]
};
const ADMIN_MEASUREMENT_LABELS = {
  bust: "Bust / chest",
  waist: "Waist",
  hip: "Hips",
  shoulder: "Shoulder",
  armhole: "Armhole",
  sleeve_length: "Sleeve length",
  blouse_length: "Blouse length",
  front_neck_depth: "Front neck depth",
  back_neck_depth: "Back neck depth",
  top_length: "Suit top length",
  trouser_waist: "Trouser waist",
  trouser_hip: "Trouser hip",
  trouser_length: "Trouser length",
  inseam: "Inseam",
  blouse_bust: "Blouse bust",
  blouse_waist: "Blouse waist",
  blouse_shoulder: "Blouse shoulder",
  blouse_sleeve_length: "Blouse sleeve length",
  lehenga_waist: "Lehenga waist",
  lehenga_hip: "Lehenga hip",
  lehenga_length: "Lehenga length",
  kurti_length: "Kurti length",
  thigh: "Thigh",
  outseam: "Outseam",
  ankle_opening: "Ankle opening",
  gown_length: "Gown length"
};

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

async function initializeAdminMeasurementManagement() {
  const filterForm = document.querySelector("#admin-measurement-filter-form");
  if (!filterForm) return;

  const profilesBody = document.querySelector("#admin-measurements-body");
  const profilesMessage = document.querySelector("#admin-measurements-message");
  const pageLabel = document.querySelector("#admin-measurements-page-label");
  const detailPanel = document.querySelector("#admin-measurement-detail");
  const detailTitle = document.querySelector("#admin-measurement-detail-title");
  const detailMessage = document.querySelector("#admin-measurement-detail-message");
  const detailContent = document.querySelector("#admin-measurement-detail-content");
  const detailActions = document.querySelector("#admin-measurement-detail-actions");
  const editForm = document.querySelector("#admin-measurement-edit-form");
  const profileNameInput = document.querySelector("#admin-measurement-profile-name");
  const categorySelect = document.querySelector("#admin-measurement-profile-category");
  const unitSelect = document.querySelector("#admin-measurement-profile-unit");
  const fittingSelect = document.querySelector("#admin-measurement-fitting");
  const notesInput = document.querySelector("#admin-measurement-notes");
  const fieldsContainer = document.querySelector("#admin-measurement-fields");
  const saveButton = document.querySelector("#admin-measurement-save");
  let measurementRanges = null;
  let currentPage = 1;
  let totalPages = 1;
  let currentProfile = null;
  let selectedProfileId = null;
  let measurementsCmByCategory = {};
  let measurementsDirty = false;
  let originalMeasurementsCm = {};
  const changedMeasurementFields = new Set();
  let savePending = false;
  let listRequestId = 0;

  function redirectOnExpiredSession(error) {
    if (error.status !== 401) return false;
    window.location.replace("admin-login.html");
    return true;
  }

  function formatMeasurementDate(value) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return formatAdminDate(date);
  }

  function toCentimeters(value, unit) {
    return unit === "in" ? value * 2.54 : value;
  }

  function fromCentimeters(value, unit) {
    return unit === "in" ? value / 2.54 : value;
  }

  function displayMeasurement(value) {
    return Number(value.toFixed(2)).toString();
  }

  function applyInputRange(input, category, field, unit) {
    const range = measurementRanges?.[category]?.[field];
    if (!range) return;
    const converted = window.DAZZLE_MEASUREMENT_PROFILE_EDITOR.rangeInUnit(range, unit);
    input.min = String(converted[0]);
    input.max = String(converted[1]);
    input.step = "0.01";
  }

  function measurementIsChanged(field) {
    return categorySelect.value !== currentProfile?.garmentCategory ||
      changedMeasurementFields.has(field);
  }

  function getCurrentMeasurements() {
    const category = categorySelect.value;
    if (!measurementsCmByCategory[category]) measurementsCmByCategory[category] = {};
    return measurementsCmByCategory[category];
  }

  function addMeasurementDetail(profile) {
    const measurementBlock = document.createElement("section");
    measurementBlock.className = "admin-detail-block admin-measurement-values";
    const heading = document.createElement("h3");
    heading.textContent = `Measurements (${profile.unitPreference})`;
    measurementBlock.append(heading);

    const entries = Object.entries(profile.measurements || {});
    const outOfRange = entries.filter(([field, value]) => {
      const range = measurementRanges[profile.garmentCategory]?.[field];
      return range && !window.DAZZLE_MEASUREMENT_PROFILE_EDITOR.isWithinRange(
        toCentimeters(Number(value), profile.unitPreference),
        range
      );
    });
    if (outOfRange.length) {
      const warning = document.createElement("p");
      warning.className = "measurement-range-warning";
      warning.setAttribute("role", "status");
      warning.textContent = "One or more saved measurements are outside the current sanity ranges. Existing values remain unchanged unless edited.";
      measurementBlock.append(warning);
    }
    if (!entries.length) {
      addDetailLine(measurementBlock, "Measurements", "No values saved");
    } else {
      for (const [field, value] of entries) {
        const label = ADMIN_MEASUREMENT_LABELS[field] ||
          field.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
        addDetailLine(measurementBlock, label, `${value} ${profile.unitPreference}`);
      }
    }
    detailContent.append(measurementBlock);
  }

  function renderProfileDetails(profile) {
    detailContent.replaceChildren();
    const customerBlock = document.createElement("section");
    customerBlock.className = "admin-detail-block";
    const customerHeading = document.createElement("h3");
    customerHeading.textContent = "Customer";
    customerBlock.append(customerHeading);
    addDetailLine(customerBlock, "Name", profile.customer.name);
    addDetailLine(customerBlock, "Phone", profile.customer.phone);
    addDetailLine(customerBlock, "Email", profile.customer.email);

    const profileBlock = document.createElement("section");
    profileBlock.className = "admin-detail-block";
    const profileHeading = document.createElement("h3");
    profileHeading.textContent = "Profile";
    profileBlock.append(profileHeading);
    addDetailLine(profileBlock, "Garment", ADMIN_GARMENT_LABELS[profile.garmentCategory]);
    addDetailLine(profileBlock, "Profile name", profile.profileName);
    addDetailLine(
      profileBlock,
      "Fitting preference",
      profile.fittingPreference || "No preference"
    );
    addDetailLine(profileBlock, "Created", formatMeasurementDate(profile.createdAt));
    addDetailLine(profileBlock, "Last updated", formatMeasurementDate(profile.updatedAt));
    addDetailLine(
      profileBlock,
      "Last updated by",
      profile.lastUpdatedBy === "ADMIN" ? "Admin" : "Customer"
    );
    addDetailLine(profileBlock, "Notes", profile.notes);

    detailContent.append(customerBlock, profileBlock);
    addMeasurementDetail(profile);
    detailTitle.textContent = profile.profileName;
  }

  function renderMeasurementInputs() {
    const category = categorySelect.value;
    const unit = unitSelect.value;
    const measurements = getCurrentMeasurements();
    fieldsContainer.replaceChildren();

    for (const field of ADMIN_MEASUREMENT_FIELDS[category]) {
      const wrapper = document.createElement("div");
      wrapper.className = "admin-measurement-field";
      const label = document.createElement("label");
      label.htmlFor = `admin-measurement-${field}`;
      label.textContent = ADMIN_MEASUREMENT_LABELS[field];

      const inputRow = document.createElement("div");
      inputRow.className = "admin-measurement-input";
      const input = document.createElement("input");
      input.id = `admin-measurement-${field}`;
      input.name = field;
      input.type = "number";
      input.inputMode = "decimal";
      applyInputRange(input, category, field, unit);
      if (Object.prototype.hasOwnProperty.call(measurements, field)) {
        input.value = displayMeasurement(fromCentimeters(measurements[field], unit));
      }
      const originalCm = originalMeasurementsCm[field];
      const originalOutOfRange = Number.isFinite(originalCm) &&
        !window.DAZZLE_MEASUREMENT_PROFILE_EDITOR.isWithinRange(
          originalCm,
          measurementRanges[category][field]
        );
      if (originalOutOfRange && !measurementIsChanged(field)) {
        input.removeAttribute("min");
        input.removeAttribute("max");
      }
      input.required = measurementIsChanged(field);

      const unitLabel = document.createElement("span");
      unitLabel.textContent = unit;
      unitLabel.setAttribute("aria-hidden", "true");
      inputRow.append(input, unitLabel);
      if (originalOutOfRange && !measurementIsChanged(field)) {
        const warning = document.createElement("small");
        warning.className = "measurement-range-warning";
        warning.setAttribute("role", "status");
        warning.textContent = "Saved value is outside the current sanity range. It will be kept unless changed.";
        wrapper.append(warning);
      }
      input.addEventListener("input", () => {
        const numericValue = Number(input.value);
        const valueCm = input.value === "" ? NaN : toCentimeters(numericValue, unit);
        const originalDisplay = Number.isFinite(originalCm)
          ? Number(fromCentimeters(originalCm, unit).toFixed(2))
          : null;
        if (currentProfile && category === currentProfile.garmentCategory &&
            Number.isFinite(originalDisplay) && numericValue === originalDisplay) {
          changedMeasurementFields.delete(field);
        } else {
          changedMeasurementFields.add(field);
        }
        measurementsDirty = changedMeasurementFields.size > 0;
        input.required = measurementIsChanged(field);
        if (measurementIsChanged(field)) {
          applyInputRange(input, category, field, unit);
        } else if (originalOutOfRange) {
          input.removeAttribute("min");
          input.removeAttribute("max");
        }
        const range = measurementRanges[category][field];
        const labelText = ADMIN_MEASUREMENT_LABELS[field];
        const acceptedRange = window.DAZZLE_MEASUREMENT_PROFILE_EDITOR.formatRange(range, unit);
        const precisionValid = Number.isFinite(numericValue) && Number(numericValue.toFixed(2)) === numericValue;
        const withinRange = window.DAZZLE_MEASUREMENT_PROFILE_EDITOR.isWithinRange(valueCm, range);
        const customError = measurementIsChanged(field) && input.value !== ""
          ? !precisionValid
            ? `${labelText} must use at most two decimal places and be within ${acceptedRange}.`
            : !withinRange
              ? `${labelText} must be within ${acceptedRange}.`
              : ""
          : "";
        input.setCustomValidity(customError);
        if (input.value === "") {
          delete measurements[field];
        } else {
          measurements[field] = toCentimeters(Number(input.value), unit);
        }
      });

      wrapper.append(label, inputRow);
      fieldsContainer.append(wrapper);
    }
  }

  function resetEditor() {
    if (!currentProfile) return;
    measurementsCmByCategory = {
      [currentProfile.garmentCategory]: Object.fromEntries(
        Object.entries(currentProfile.measurements || {}).map(([field, value]) => [
          field,
          toCentimeters(Number(value), currentProfile.unitPreference)
        ])
      )
    };
    measurementsDirty = false;
    originalMeasurementsCm = { ...measurementsCmByCategory[currentProfile.garmentCategory] };
    changedMeasurementFields.clear();
    profileNameInput.value = currentProfile.profileName;
    categorySelect.value = currentProfile.garmentCategory;
    unitSelect.value = currentProfile.unitPreference;
    fittingSelect.value = currentProfile.fittingPreference || "";
    notesInput.value = currentProfile.notes || "";
    renderMeasurementInputs();
  }

  async function loadMeasurementProfiles(page = currentPage) {
    const requestId = ++listRequestId;
    const query = new URLSearchParams(new FormData(filterForm));
    query.set("page", String(page));
    query.set("pageSize", "20");
    profilesBody.replaceChildren();
    setAdminMessage(profilesMessage, "Loading customer measurements…");
    document.querySelector("#admin-measurements-previous").disabled = true;
    document.querySelector("#admin-measurements-next").disabled = true;

    try {
      const result = await adminApi(`/api/admin/measurement-profiles?${query.toString()}`);
      if (requestId !== listRequestId) return;
      currentPage = result.pagination.page;
      totalPages = Math.max(1, result.pagination.totalPages);
      pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;
      document.querySelector("#admin-measurements-previous").disabled = currentPage <= 1;
      document.querySelector("#admin-measurements-next").disabled = currentPage >= totalPages;

      if (!result.profiles.length) {
        setAdminMessage(profilesMessage, "No measurement profiles match these filters.");
        return;
      }
      setAdminMessage(profilesMessage, `${result.pagination.total} profile(s) found.`);

      for (const profile of result.profiles) {
        const row = document.createElement("tr");
        makeAdminCell(row, profile.customer.name);
        makeAdminCell(row, profile.customer.phone || "Not provided");
        makeAdminCell(row, profile.profileName);
        makeAdminCell(row, ADMIN_GARMENT_LABELS[profile.garmentCategory] || profile.garmentCategory);
        makeAdminCell(row, profile.unitPreference === "in" ? "Inches" : "Centimetres");
        makeAdminCell(row, formatMeasurementDate(profile.updatedAt));
        const actionCell = document.createElement("td");
        const viewButton = document.createElement("button");
        viewButton.className = "text-link admin-view-measurement";
        viewButton.type = "button";
        viewButton.textContent = "View";
        viewButton.setAttribute("aria-label", `View ${profile.profileName} for ${profile.customer.name}`);
        viewButton.addEventListener("click", () => loadMeasurementProfile(profile.profileId, viewButton));
        actionCell.append(viewButton);
        row.append(actionCell);
        profilesBody.append(row);
      }
    } catch (error) {
      if (requestId !== listRequestId) return;
      if (redirectOnExpiredSession(error)) return;
      setAdminMessage(profilesMessage, error.message, true);
      pageLabel.textContent = `Page ${page} of ${totalPages}`;
    }
  }

  async function loadMeasurementProfile(profileId, button) {
    selectedProfileId = profileId;
    currentProfile = null;
    detailPanel.hidden = false;
    detailActions.hidden = true;
    editForm.hidden = true;
    detailContent.replaceChildren();
    setAdminMessage(detailMessage, "Loading measurement details…");
    if (button) button.disabled = true;
    try {
      const result = await adminApi(
        `/api/admin/measurement-profiles/${encodeURIComponent(profileId)}`
      );
      if (selectedProfileId !== profileId) return;
      currentProfile = result.profile;
      renderProfileDetails(currentProfile);
      detailActions.hidden = false;
      setAdminMessage(detailMessage, "");
      detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (redirectOnExpiredSession(error)) return;
      setAdminMessage(detailMessage, error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function saveMeasurementProfile(event) {
    event.preventDefault();
    if (!currentProfile || savePending) return;
    for (const input of [profileNameInput, categorySelect, unitSelect, fittingSelect, notesInput]) {
      if (!input.reportValidity()) return;
    }

    const category = categorySelect.value;
    const categoryChanged = category !== currentProfile.garmentCategory;
    const shouldReplaceMeasurements = categoryChanged || measurementsDirty;
    const body = {
      profileName: profileNameInput.value.trim(),
      garmentCategory: category,
      unitPreference: unitSelect.value,
      fittingPreference: fittingSelect.value || null,
      notes: notesInput.value.trim() || null
    };

    if (shouldReplaceMeasurements) {
      for (const input of fieldsContainer.querySelectorAll("input")) {
        if (!measurementIsChanged(input.name)) continue;
        if (!input.reportValidity()) return;
      }
      const measurementsCm = getCurrentMeasurements();
      const measurements = {};
      for (const field of ADMIN_MEASUREMENT_FIELDS[category]) {
        if (!measurementIsChanged(field)) continue;
        if (!Object.prototype.hasOwnProperty.call(measurementsCm, field)) continue;
        measurements[field] = Number(fromCentimeters(
          measurementsCm[field],
          unitSelect.value
        ).toFixed(2));
      }
      if (!Object.keys(measurements).length) {
        setAdminMessage(
          detailMessage,
          "Enter at least one measurement for the selected garment category.",
          true
        );
        return;
      }
      body.measurements = measurements;
    }

    savePending = true;
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    setAdminMessage(detailMessage, "Saving profile changes…");
    try {
      const result = await adminApi(
        `/api/admin/measurement-profiles/${encodeURIComponent(currentProfile.profileId)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      currentProfile = {
        ...result.profile,
        customer: currentProfile.customer
      };
      renderProfileDetails(currentProfile);
      resetEditor();
      editForm.hidden = true;
      detailActions.hidden = false;
      await loadMeasurementProfiles(currentPage);
      setAdminMessage(detailMessage, "Measurement profile updated.");
    } catch (error) {
      if (redirectOnExpiredSession(error)) return;
      setAdminMessage(detailMessage, error.message, true);
    } finally {
      savePending = false;
      saveButton.disabled = false;
      saveButton.textContent = "Save changes";
    }
  }

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadMeasurementProfiles(1);
  });
  document.querySelector("#admin-measurement-clear").addEventListener("click", () => {
    filterForm.reset();
    loadMeasurementProfiles(1);
  });
  document.querySelector("#admin-measurements-previous").addEventListener("click", () => {
    if (currentPage > 1) loadMeasurementProfiles(currentPage - 1);
  });
  document.querySelector("#admin-measurements-next").addEventListener("click", () => {
    if (currentPage < totalPages) loadMeasurementProfiles(currentPage + 1);
  });
  document.querySelector("#admin-measurement-close").addEventListener("click", () => {
    selectedProfileId = null;
    currentProfile = null;
    detailPanel.hidden = true;
    detailActions.hidden = true;
    editForm.hidden = true;
  });
  document.querySelector("#admin-measurement-edit").addEventListener("click", () => {
    if (!currentProfile) return;
    resetEditor();
    detailActions.hidden = true;
    editForm.hidden = false;
    setAdminMessage(detailMessage, "");
    editForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelector("#admin-measurement-cancel").addEventListener("click", () => {
    resetEditor();
    editForm.hidden = true;
    detailActions.hidden = false;
    setAdminMessage(detailMessage, "No changes were saved.");
  });
  categorySelect.addEventListener("change", renderMeasurementInputs);
  unitSelect.addEventListener("change", renderMeasurementInputs);
  editForm.addEventListener("submit", saveMeasurementProfile);

  saveButton.formNoValidate = true;
  try {
    const result = await adminApi("/api/measurement-rules");
    measurementRanges = result.ranges;
  } catch (error) {
    setAdminMessage(profilesMessage, `Measurement rules could not be loaded: ${error.message}`, true);
    return;
  }
  await loadMeasurementProfiles(1);
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
  await Promise.all([
    loadSummary(),
    loadOrders(1),
    initializeAdminMeasurementManagement()
  ]);
}

initializeAdminLogin();
initializeAdminDashboard();
