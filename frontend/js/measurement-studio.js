(() => {
  const apiRequest = window.DAZZLE_ACCOUNT_API;
  const builder = document.querySelector("#measurement-form");
  if (!builder || typeof apiRequest !== "function") return;

  const categorySelect = document.querySelector("#profile-category");
  const profileNameInput = document.querySelector("#profile-name");
  const fittingSelect = document.querySelector("#profile-fitting");
  const unitSelect = document.querySelector("#profile-unit");
  const notesInput = document.querySelector("#profile-notes");
  const fieldsContainer = document.querySelector("#measurement-fields");
  const reviewContainer = document.querySelector("#measurement-review");
  const authNotice = document.querySelector("#studio-auth-notice");
  const pageMessage = document.querySelector("#studio-page-message");
  const bookContent = document.querySelector("#book-content");
  const bookLoading = document.querySelector("#book-loading");
  const bookError = document.querySelector("#book-error-state");
  const bookErrorMessage = document.querySelector("#book-error-message");
  const bookEmpty = document.querySelector("#book-empty-state");
  const bookList = document.querySelector("#profile-list");
  const bookMessage = document.querySelector("#book-message");
  const saveButton = document.querySelector("#save-measurements");
  const confirmCheckbox = document.querySelector("#confirm-measurements");
  const progressBar = document.querySelector(".studio-progress-track");
  const progressFill = document.querySelector("#studio-progress-fill");
  const stepLabel = document.querySelector("#studio-step-label");
  const startButtons = [
    document.querySelector("#start-measuring"),
    document.querySelector("#book-start-measuring")
  ];

  const categoryLabels = {
    BLOUSE: "Blouse",
    SUIT_SALWAR_KAMEEZ: "Suit / Salwar Kameez",
    LEHENGA: "Lehenga",
    KURTI: "Kurti",
    PANTS_PALAZZO: "Pants / Palazzo",
    ANARKALI_GOWN: "Anarkali / Gown"
  };

  const measurementFields = {
    bust: ["Bust / chest", "Wrap around the fullest part of the chest, keeping the tape level across the back."],
    waist: ["Waist", "Measure around your natural waist while breathing normally."],
    hip: ["Hips", "Measure around the fullest part of the hips and seat, with the tape level."],
    shoulder: ["Shoulder", "Measure from the outer edge of one shoulder to the other."],
    armhole: ["Armhole", "Loop around the shoulder and underarm where a sleeve seam would sit."],
    sleeve_length: ["Sleeve length", "Measure from the shoulder point along a slightly bent arm to the sleeve end."],
    blouse_length: ["Blouse length", "Measure from the shoulder near the neck down to your preferred blouse hem."],
    front_neck_depth: ["Front neck depth", "Measure from the shoulder near the neck to the preferred front neckline point."],
    back_neck_depth: ["Back neck depth", "Measure from the shoulder near the neck to the preferred back neckline point."],
    top_length: ["Suit top length", "Measure from the shoulder near the neck to the desired top hem."],
    trouser_waist: ["Trouser waist", "Measure around where you prefer the trouser waistband to sit."],
    trouser_hip: ["Trouser hip", "Measure around the fullest part of the hips and seat."],
    trouser_length: ["Trouser length", "Measure from the waistband position to the desired trouser hem."],
    inseam: ["Inseam", "Measure from the top of the inner thigh to the ankle or trouser hem."],
    blouse_bust: ["Blouse bust", "Wrap around the fullest part of the chest, keeping the tape level."],
    blouse_waist: ["Blouse waist", "Measure around the waist where the blouse will sit."],
    blouse_shoulder: ["Blouse shoulder", "Measure from the outer edge of one shoulder to the other."],
    blouse_sleeve_length: ["Blouse sleeve length", "Measure from the shoulder point along a slightly bent arm."],
    lehenga_waist: ["Lehenga waist", "Measure around the waist where the lehenga waistband will sit."],
    lehenga_hip: ["Lehenga hip", "Measure around the fullest part of the hips and seat."],
    lehenga_length: ["Lehenga length", "Measure from the waistband position to your preferred hem."],
    kurti_length: ["Kurti length", "Measure from the shoulder near the neck to your preferred kurti hem."],
    thigh: ["Thigh", "Measure around the fullest part of the upper thigh without tightening the tape."],
    outseam: ["Outseam", "Measure from the waistband position down the outside of the leg to the hem."],
    ankle_opening: ["Ankle opening", "Measure around your ankle or the opening size you prefer for the garment."],
    gown_length: ["Gown length", "Measure from the shoulder near the neck to the desired gown hem."]
  };

  const categoryFields = {
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

  let measurementRanges = null;
  const state = {
    auth: "loading",
    profiles: [],
    step: 1,
    editingProfileId: null,
    originalGarmentCategory: null,
    measurementsDirty: false,
    measurementsCm: {},
    originalMeasurementsCm: {},
    originalUnit: "cm",
    changedMeasurementFields: new Set()
  };

  function showMessage(element, message, isError = false, isSuccess = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("form-message-error", isError);
    element.classList.toggle("form-message-success", isSuccess);
  }

  function getCurrentMeasurements() {
    const category = categorySelect.value;
    if (!state.measurementsCm[category]) state.measurementsCm[category] = {};
    return state.measurementsCm[category];
  }

  function toCentimeters(value, unit) {
    return unit === "in" ? value * 2.54 : value;
  }

  function fromCentimeters(value, unit) {
    return unit === "in" ? value / 2.54 : value;
  }

  function displayNumber(value) {
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
    if (!state.editingProfileId || categorySelect.value !== state.originalGarmentCategory) return true;
    return state.changedMeasurementFields.has(field);
  }

  function formatDate(value) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  }

  function friendlyError(error, fallback) {
    return error instanceof TypeError
      ? "Unable to connect to the account service. Please try again."
      : error.message || fallback;
  }

  function updateCreateButtons() {
    const atLimit = state.profiles.length >= 20;
    for (const button of startButtons) {
      if (button) {
        button.disabled = state.auth === "loading" || state.auth === "error" ||
          (state.auth === "signed-in" && atLimit);
      }
    }
    const emptyStart = bookEmpty.querySelector("[data-start-profile]");
    if (emptyStart) emptyStart.disabled = state.profiles.length >= 20;
  }

  function enterSignedOutState() {
    state.auth = "signed-out";
    state.profiles = [];
    bookList.replaceChildren();
    authNotice.hidden = false;
    builder.hidden = true;
    bookContent.hidden = true;
    bookLoading.hidden = true;
    showMessage(bookMessage, "Sign in to view your private Measurement Book.");
    updateCreateButtons();
  }

  function renderMeasurementFields() {
    const category = categorySelect.value;
    const fields = categoryFields[category] || [];
    const unit = unitSelect.value;
    const measurements = getCurrentMeasurements();
    fieldsContainer.replaceChildren();

    for (const field of fields) {
      const [labelText, guidance] = measurementFields[field];
      const wrapper = document.createElement("div");
      wrapper.className = "studio-measurement-field";

      const label = document.createElement("label");
      label.htmlFor = `measurement-${field}`;
      label.textContent = labelText;

      const inputRow = document.createElement("div");
      inputRow.className = "studio-number-input";
      const input = document.createElement("input");
      input.id = `measurement-${field}`;
      input.name = field;
      input.type = "number";
      input.inputMode = "decimal";
      applyInputRange(input, category, field, unit);
      input.required = !state.editingProfileId || measurementIsChanged(field);
      input.setAttribute("aria-describedby", `measurement-help-${field}`);
      if (Object.prototype.hasOwnProperty.call(measurements, field)) {
        input.value = displayNumber(fromCentimeters(measurements[field], unit));
      }
      const originalCm = state.originalMeasurementsCm[field];
      const originalOutOfRange = state.editingProfileId &&
        Number.isFinite(originalCm) &&
        !window.DAZZLE_MEASUREMENT_PROFILE_EDITOR.isWithinRange(
          originalCm,
          measurementRanges[category][field]
        );
      if (originalOutOfRange && !measurementIsChanged(field)) {
        input.removeAttribute("min");
        input.removeAttribute("max");
      }

      const unitLabel = document.createElement("span");
      unitLabel.textContent = unit;
      unitLabel.setAttribute("aria-hidden", "true");
      inputRow.append(input, unitLabel);

      const help = document.createElement("small");
      help.id = `measurement-help-${field}`;
      help.textContent = guidance;

      if (originalOutOfRange && !measurementIsChanged(field)) {
        const warning = document.createElement("small");
        warning.className = "measurement-range-warning";
        warning.setAttribute("role", "status");
        warning.textContent = "This saved value is outside the current sanity range. It will be kept unless you change this measurement.";
        wrapper.append(warning);
      }

      input.addEventListener("input", () => {
        const numericValue = Number(input.value);
        const valueCm = input.value === "" ? NaN : toCentimeters(numericValue, unit);
        const originalDisplay = Number.isFinite(originalCm)
          ? Number(fromCentimeters(originalCm, unit).toFixed(2))
          : null;
        if (state.editingProfileId && category === state.originalGarmentCategory &&
            Number.isFinite(originalDisplay) && numericValue === originalDisplay) {
          state.changedMeasurementFields.delete(field);
        } else {
          state.changedMeasurementFields.add(field);
        }
        state.measurementsDirty = state.changedMeasurementFields.size > 0;
        input.required = !state.editingProfileId || measurementIsChanged(field);
        if (measurementIsChanged(field)) {
          applyInputRange(input, category, field, unit);
        } else if (originalOutOfRange) {
          input.removeAttribute("min");
          input.removeAttribute("max");
        }
        const range = measurementRanges[category][field];
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

      wrapper.append(label, inputRow, help);
      fieldsContainer.append(wrapper);
    }
  }

  function showStep(step) {
    state.step = step;
    builder.querySelectorAll(".studio-step").forEach((section) => {
      section.hidden = Number(section.dataset.step) !== step;
    });
    const labels = [
      "Choose your garment",
      "Add your measurements",
      "Review and confirm"
    ];
    stepLabel.textContent = `Step ${step} of 3 · ${labels[step - 1]}`;
    progressBar.setAttribute("aria-valuenow", String(step));
    progressFill.style.width = `${(step / 3) * 100}%`;
    if (step === 2) renderMeasurementFields();
    if (step === 3) renderReview();
  }

  function addReviewRow(list, label, value) {
    const row = document.createElement("div");
    row.className = "studio-review-row";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value || "Not specified";
    row.append(term, description);
    list.append(row);
  }

  function renderReview() {
    const unit = unitSelect.value;
    const category = categorySelect.value;
    const measurements = getCurrentMeasurements();
    const wrapper = document.createElement("div");
    wrapper.className = "studio-review-card";
    const heading = document.createElement("h4");
    heading.textContent = profileNameInput.value.trim();
    const summary = document.createElement("p");
    summary.textContent = `${categoryLabels[category]} · ${unit === "in" ? "Inches" : "Centimetres"} · ${fittingSelect.value || "No fitting preference"}`;
    const list = document.createElement("dl");
    list.className = "studio-review-list";
    const outOfRange = Object.entries(profile.measurements || {}).filter(([field, value]) => {
      const range = measurementRanges?.[profile.garmentCategory]?.[field];
      return range && !window.DAZZLE_MEASUREMENT_PROFILE_EDITOR.isWithinRange(
        toCentimeters(Number(value), profile.unitPreference), range
      );
    });
    if (outOfRange.length) {
      const warning = document.createElement("p");
      warning.className = "measurement-range-warning";
      warning.setAttribute("role", "status");
      warning.textContent = "One or more saved measurements are outside the current sanity ranges. Existing values have been kept.";
      wrapper.append(warning);
    }

    for (const field of categoryFields[category]) {
      const [label] = measurementFields[field];
      if (!Object.prototype.hasOwnProperty.call(measurements, field)) {
        addReviewRow(list, label, "Not specified");
        continue;
      }
      const value = displayNumber(fromCentimeters(measurements[field], unit));
      addReviewRow(list, label, `${value} ${unit}`);
    }
    if (notesInput.value.trim()) addReviewRow(list, "Fit notes", notesInput.value.trim());
    wrapper.append(heading, summary, list);
    reviewContainer.replaceChildren(wrapper);
  }

  function resetDraft() {
    state.editingProfileId = null;
    state.originalGarmentCategory = null;
    state.measurementsDirty = false;
    state.measurementsCm = {};
    state.originalMeasurementsCm = {};
    state.originalUnit = "cm";
    state.changedMeasurementFields.clear();
    categorySelect.value = "";
    profileNameInput.value = "";
    fittingSelect.value = "";
    unitSelect.value = "cm";
    notesInput.value = "";
    confirmCheckbox.checked = false;
    saveButton.disabled = true;
    saveButton.textContent = "Save measurement profile";
    builder.querySelector("[data-cancel-edit]").hidden = true;
  }

  function startNewProfile() {
    if (!measurementRanges) {
      showMessage(pageMessage, "Measurement validation rules are unavailable. Please refresh and try again.", true);
      return;
    }
    if (state.auth === "loading" || state.auth === "error") {
      showMessage(pageMessage, "Checking your customer session. Please try again in a moment.");
      return;
    }
    if (state.auth === "signed-out") {
      authNotice.hidden = false;
      authNotice.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (state.profiles.length >= 20) {
      showMessage(pageMessage, "Your Measurement Book has reached the 20-profile limit. Edit or remove a profile before creating another.");
      return;
    }
    resetDraft();
    builder.hidden = false;
    showMessage(pageMessage, "");
    showStep(1);
    builder.scrollIntoView({ behavior: "smooth", block: "start" });
    categorySelect.focus({ preventScroll: true });
  }

  function renderProfileDetails(profile, details) {
    const wrapper = document.createElement("div");
    wrapper.className = "studio-profile-detail-body";
    const list = document.createElement("dl");
    list.className = "studio-review-list";
    addReviewRow(list, "Garment", categoryLabels[profile.garmentCategory] || profile.garmentCategory);
    addReviewRow(list, "Fitting preference", profile.fittingPreference || "No preference");
    for (const field of categoryFields[profile.garmentCategory] || []) {
      if (!Object.prototype.hasOwnProperty.call(profile.measurements, field)) continue;
      addReviewRow(
        list,
        measurementFields[field][0],
        `${profile.measurements[field]} ${profile.unitPreference}`
      );
    }
    if (profile.notes) addReviewRow(list, "Fit notes", profile.notes);
    wrapper.append(list);
    details.replaceChildren(wrapper);
  }

  function renderProfiles() {
    bookList.replaceChildren();
    bookEmpty.hidden = state.profiles.length > 0;
    bookList.hidden = state.profiles.length === 0;
    for (const profile of state.profiles) {
      const item = document.createElement("li");
      item.className = "studio-profile-card";
      const header = document.createElement("div");
      header.className = "studio-profile-header";
      const titleGroup = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = profile.profileName;
      const category = document.createElement("p");
      category.className = "studio-profile-category";
      category.textContent = categoryLabels[profile.garmentCategory] || profile.garmentCategory;
      titleGroup.append(title, category);

      const metadata = document.createElement("p");
      metadata.className = "studio-profile-meta";
      metadata.textContent = `${profile.unitPreference === "in" ? "Inches" : "Centimetres"} · Updated ${formatDate(profile.updatedAt)}`;

      const actions = document.createElement("div");
      actions.className = "studio-profile-actions";
      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "text-button";
      viewButton.textContent = "View details";
      viewButton.setAttribute("aria-expanded", "false");
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "text-button";
      editButton.textContent = "Edit";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "text-button studio-delete-button";
      deleteButton.textContent = "Delete";

      const details = document.createElement("div");
      details.className = "studio-profile-details";
      details.hidden = true;
      renderProfileDetails(profile, details);

      viewButton.addEventListener("click", () => {
        details.hidden = !details.hidden;
        viewButton.setAttribute("aria-expanded", String(!details.hidden));
        viewButton.textContent = details.hidden ? "View details" : "Hide details";
      });
      editButton.addEventListener("click", () => loadProfileForEdit(profile.profileId, editButton));
      deleteButton.addEventListener("click", () => deleteProfile(profile.profileId, deleteButton));

      actions.append(viewButton, editButton, deleteButton);
      header.append(titleGroup, actions);
      item.append(header, metadata, details);
      bookList.append(item);
    }
    updateCreateButtons();
  }

  async function loadProfiles() {
    state.auth = "loading";
    bookContent.hidden = false;
    bookLoading.hidden = false;
    bookError.hidden = true;
    bookEmpty.hidden = true;
    bookList.hidden = true;
    try {
      const result = await apiRequest("/api/account/measurement-profiles");
      state.auth = "signed-in";
      state.profiles = result.profiles;
      authNotice.hidden = true;
      bookLoading.hidden = true;
      renderProfiles();
      showMessage(bookMessage, "");
      updateCreateButtons();
      return true;
    } catch (error) {
      bookLoading.hidden = true;
      if (error.status === 401) {
        enterSignedOutState();
        return false;
      }
      state.auth = "error";
      bookContent.hidden = false;
      bookError.hidden = false;
      bookErrorMessage.textContent = friendlyError(error, "Your Measurement Book could not be loaded.");
      updateCreateButtons();
      return false;
    }
  }

  async function loadProfileForEdit(profileId, button) {
    if (!measurementRanges) {
      showMessage(pageMessage, "Measurement validation rules are unavailable. Please refresh and try again.", true);
      return;
    }
    button.disabled = true;
    try {
      const result = await apiRequest(`/api/account/measurement-profiles/${profileId}`);
      const profile = result.profile;
      resetDraft();
      state.editingProfileId = profile.profileId;
      state.originalGarmentCategory = profile.garmentCategory;
      categorySelect.value = profile.garmentCategory;
      profileNameInput.value = profile.profileName;
      fittingSelect.value = profile.fittingPreference || "";
      unitSelect.value = profile.unitPreference;
      notesInput.value = profile.notes || "";
      const valuesCm = {};
      for (const [field, value] of Object.entries(profile.measurements)) {
        valuesCm[field] = toCentimeters(Number(value), profile.unitPreference);
      }
      state.measurementsCm[profile.garmentCategory] = valuesCm;
      state.originalMeasurementsCm = { ...valuesCm };
      state.originalUnit = profile.unitPreference;
      state.changedMeasurementFields.clear();
      builder.querySelector("[data-cancel-edit]").hidden = false;
      builder.hidden = false;
      showMessage(pageMessage, `Editing ${profile.profileName}. Your existing values are loaded.`);
      showStep(1);
      builder.scrollIntoView({ behavior: "smooth", block: "start" });
      categorySelect.focus({ preventScroll: true });
    } catch (error) {
      if (error.status === 401) {
        enterSignedOutState();
      } else {
        showMessage(bookMessage, friendlyError(error, "This profile could not be opened."), true);
      }
    } finally {
      button.disabled = false;
    }
  }

  async function deleteProfile(profileId, button) {
    if (!window.confirm("Delete this measurement profile? This cannot be undone.")) return;
    button.disabled = true;
    showMessage(bookMessage, "Deleting profile…");
    try {
      await apiRequest(`/api/account/measurement-profiles/${profileId}`, { method: "DELETE" });
      const refreshed = await loadProfiles();
      showMessage(
        bookMessage,
        refreshed
          ? "Measurement profile deleted."
          : "The profile was deleted, but your Measurement Book could not be refreshed.",
        !refreshed,
        refreshed
      );
    } catch (error) {
      if (error.status === 401) {
        enterSignedOutState();
      } else {
        showMessage(bookMessage, friendlyError(error, "This profile could not be deleted."), true);
        button.disabled = false;
      }
    }
  }

  function prepareRequestBody() {
    const category = categorySelect.value;
    const unit = unitSelect.value;
    const measurements = window.DAZZLE_MEASUREMENT_PROFILE_EDITOR.buildMeasurementPatch({
      editing: Boolean(state.editingProfileId),
      originalCategory: state.originalGarmentCategory,
      category,
      measurementsDirty: state.measurementsDirty,
      measurementsCm: getCurrentMeasurements(),
      fields: categoryFields[category],
      changedFields: state.changedMeasurementFields,
      unit
    });
    const body = {
      garmentCategory: category,
      profileName: profileNameInput.value.trim(),
      unitPreference: unit,
      fittingPreference: fittingSelect.value || null,
      notes: notesInput.value.trim() || null
    };
    if (measurements !== undefined) body.measurements = measurements;
    return body;
  }

  categorySelect.addEventListener("change", () => {
    if (state.step === 2) renderMeasurementFields();
  });

  unitSelect.addEventListener("change", () => {
    renderMeasurementFields();
  });

  builder.querySelectorAll("[data-next-step]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.step === 1) {
        if (!categorySelect.reportValidity() || !profileNameInput.reportValidity()) return;
        showMessage(pageMessage, "");
        showStep(2);
        return;
      }
      const fields = fieldsContainer.querySelectorAll("input[required]");
      for (const field of fields) {
        if (!measurementIsChanged(field.name)) continue;
        if (!field.reportValidity()) return;
      }
      showMessage(pageMessage, "");
      confirmCheckbox.checked = false;
      saveButton.disabled = true;
      showStep(3);
    });
  });

  builder.querySelectorAll("[data-previous-step]").forEach((button) => {
    button.addEventListener("click", () => showStep(state.step - 1));
  });

  confirmCheckbox.addEventListener("change", () => {
    saveButton.disabled = !confirmCheckbox.checked;
  });

  builder.querySelector("[data-cancel-edit]").addEventListener("click", () => {
    if (!window.confirm("Discard your unsaved edits and return to your Measurement Book?")) return;
    resetDraft();
    builder.hidden = true;
    showMessage(pageMessage, "");
  });

  builder.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!confirmCheckbox.checked || saveButton.disabled) return;
    for (const field of fieldsContainer.querySelectorAll("input[required]")) {
      if (!measurementIsChanged(field.name)) continue;
      if (!field.reportValidity()) return;
    }
    saveButton.disabled = true;
    const originalLabel = saveButton.textContent;
    saveButton.textContent = "Saving…";
    showMessage(pageMessage, "");
    const wasEditing = Boolean(state.editingProfileId);
    try {
      const body = JSON.stringify(prepareRequestBody());
      const result = state.editingProfileId
        ? await apiRequest(`/api/account/measurement-profiles/${state.editingProfileId}`, {
          method: "PATCH",
          body
        })
        : await apiRequest("/api/account/measurement-profiles", {
          method: "POST",
          body
        });
      const savedName = result.profile.profileName;
      resetDraft();
      builder.hidden = true;
      showMessage(
        pageMessage,
        wasEditing
          ? "Your measurement profile has been updated."
          : `${savedName} has been saved to your Measurement Book.`,
        false,
        true
      );
      await loadProfiles();
      document.querySelector("#measurement-book").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      saveButton.disabled = false;
      saveButton.textContent = originalLabel;
      if (error.status === 401) {
        enterSignedOutState();
      } else {
        showMessage(pageMessage, friendlyError(error, "Your profile could not be saved."), true);
      }
    }
  });

  saveButton.formNoValidate = true;

  for (const button of startButtons) {
    if (button) button.addEventListener("click", startNewProfile);
  }
  bookEmpty.querySelector("[data-start-profile]").addEventListener("click", startNewProfile);
  document.querySelector("#retry-book").addEventListener("click", loadProfiles);

  apiRequest("/api/measurement-rules").then((result) => {
    measurementRanges = result.ranges;
    return loadProfiles();
  }).then((signedIn) => {
    const params = new URLSearchParams(window.location.search);
    if (signedIn && params.get("start") === "1") {
      startNewProfile();
      window.history.replaceState(null, "", `${window.location.pathname}#profile-builder`);
    }
  }).catch((error) => {
    showMessage(bookMessage, friendlyError(error, "Measurement rules could not be loaded."), true);
    loadProfiles();
  });
})();
