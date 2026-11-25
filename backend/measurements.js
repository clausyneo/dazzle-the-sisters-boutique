const { RequestError } = require("./orders");

const GARMENT_CATEGORIES = Object.freeze([
  "BLOUSE",
  "SUIT_SALWAR_KAMEEZ",
  "LEHENGA",
  "KURTI",
  "PANTS_PALAZZO",
  "ANARKALI_GOWN"
]);

const MEASUREMENT_FIELDS = Object.freeze({
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
  PANTS_PALAZZO: [
    "waist", "hip", "thigh", "inseam", "outseam", "ankle_opening"
  ],
  ANARKALI_GOWN: [
    "bust", "waist", "hip", "shoulder", "armhole", "sleeve_length", "gown_length"
  ]
});

const UNIT_PREFERENCES = new Set(["cm", "in"]);
const FITTING_PREFERENCES = new Set(["SNUG", "REGULAR", "RELAXED"]);
const PROFILE_INPUT_FIELDS = new Set([
  "garmentCategory",
  "profileName",
  "measurements",
  "unitPreference",
  "fittingPreference",
  "notes"
]);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 1_000_000;
const MAX_MEASUREMENT_CM = 400;
const MAX_PROFILES_PER_CUSTOMER = 20;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }
}

function validateProfileId(rawProfileId) {
  const value = String(rawProfileId);
  if (!/^\d+$/.test(value)) {
    throw new RequestError(400, "A measurement profile ID is invalid.");
  }
  const profileId = Number(value);
  if (!Number.isSafeInteger(profileId) || profileId < 1) {
    throw new RequestError(400, "A measurement profile ID is invalid.");
  }
  return profileId;
}

function validateCategory(value) {
  if (!GARMENT_CATEGORIES.includes(value)) {
    throw new RequestError(400, "The selected garment category is invalid.");
  }
  return value;
}

function validateProfileName(value) {
  if (typeof value !== "string") {
    throw new RequestError(400, "A profile name is required.");
  }
  const profileName = value.trim();
  if (!profileName || profileName.length > 100) {
    throw new RequestError(400, "A profile name is required and must be at most 100 characters.");
  }
  return profileName;
}

function validateUnitPreference(value) {
  if (!UNIT_PREFERENCES.has(value)) {
    throw new RequestError(400, "The unit preference must be cm or in.");
  }
  return value;
}

function validateFittingPreference(value) {
  if (value === null) return null;
  if (!FITTING_PREFERENCES.has(value)) {
    throw new RequestError(400, "The fitting preference is invalid.");
  }
  return value;
}

function validateNotes(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 1000) {
    throw new RequestError(400, "Notes must be text of at most 1000 characters.");
  }
  return value.trim() || null;
}

function validateMeasurements(category, unitPreference, values) {
  requireObject(values);
  const allowedFields = MEASUREMENT_FIELDS[category];
  const entries = Object.entries(values);
  if (!entries.length) {
    throw new RequestError(400, "At least one measurement value is required.");
  }

  const normalized = {};
  for (const [field, value] of entries) {
    if (!allowedFields.includes(field)) {
      throw new RequestError(400, `The measurement field '${field}' is invalid for this garment.`);
    }
    if (typeof value !== "number" || !Number.isFinite(value) ||
        value < 0.1 || Number(value.toFixed(2)) !== value) {
      throw new RequestError(400, "Measurement values must be positive numbers with at most two decimals.");
    }

    const centimeters = unitPreference === "in" ? value * 2.54 : value;
    if (centimeters > MAX_MEASUREMENT_CM) {
      throw new RequestError(400, "A measurement value is outside the supported range.");
    }
    normalized[field] = Number(centimeters.toFixed(3));
  }
  return normalized;
}

function validateCreateInput(body) {
  requireObject(body);
  for (const key of Object.keys(body)) {
    if (!PROFILE_INPUT_FIELDS.has(key)) {
      throw new RequestError(400, `The field '${key}' is not supported.`);
    }
  }
  if (!hasOwn(body, "garmentCategory") ||
      !hasOwn(body, "profileName") ||
      !hasOwn(body, "measurements")) {
    throw new RequestError(400, "Garment category, profile name and measurements are required.");
  }

  const garmentCategory = validateCategory(body.garmentCategory);
  const unitPreference = body.unitPreference === undefined
    ? "cm"
    : validateUnitPreference(body.unitPreference);
  return {
    garmentCategory,
    profileName: validateProfileName(body.profileName),
    unitPreference,
    fittingPreference: body.fittingPreference === undefined
      ? null
      : validateFittingPreference(body.fittingPreference),
    notes: validateNotes(body.notes),
    measurementsCm: validateMeasurements(garmentCategory, unitPreference, body.measurements)
  };
}

function validateUpdateInput(body, existing) {
  requireObject(body);
  const keys = Object.keys(body);
  if (!keys.length) {
    throw new RequestError(400, "At least one profile field must be provided.");
  }
  for (const key of keys) {
    if (!PROFILE_INPUT_FIELDS.has(key)) {
      throw new RequestError(400, `The field '${key}' is not supported.`);
    }
  }

  const garmentCategory = hasOwn(body, "garmentCategory")
    ? validateCategory(body.garmentCategory)
    : existing.garment_category;
  const unitPreference = hasOwn(body, "unitPreference")
    ? validateUnitPreference(body.unitPreference)
    : existing.unit_preference;
  const measurementsProvided = hasOwn(body, "measurements");
  if (garmentCategory !== existing.garment_category && !measurementsProvided) {
    throw new RequestError(400, "Measurements must be provided when changing garment category.");
  }

  return {
    garmentCategory,
    profileName: hasOwn(body, "profileName")
      ? validateProfileName(body.profileName)
      : existing.profile_name,
    unitPreference,
    fittingPreference: hasOwn(body, "fittingPreference")
      ? validateFittingPreference(body.fittingPreference)
      : existing.fitting_preference,
    notes: hasOwn(body, "notes") ? validateNotes(body.notes) : existing.notes,
    measurementsProvided,
    measurementsCm: measurementsProvided
      ? validateMeasurements(garmentCategory, unitPreference, body.measurements)
      : null
  };
}

function validatePage(value) {
  if (value === null || value === undefined || value === "") return 1;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new RequestError(400, "Page must be a positive whole number.");
  }
  return page;
}

function validatePageSize(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_PAGE_SIZE;
  const pageSize = Number(value);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RequestError(400, `Page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return pageSize;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDisplayValue(valueCm, unitPreference) {
  const value = unitPreference === "in" ? Number(valueCm) / 2.54 : Number(valueCm);
  return Number(value.toFixed(2));
}

function shapeProfile(row, valueRows, includeCustomer = false) {
  const measurements = {};
  for (const value of valueRows) {
    measurements[value.measurement_key] = toDisplayValue(value.value_cm, row.unit_preference);
  }
  const profile = {
    profileId: Number(row.profile_id),
    garmentCategory: row.garment_category,
    profileName: row.profile_name,
    unitPreference: row.unit_preference,
    fittingPreference: row.fitting_preference,
    notes: row.notes,
    measurements,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    lastUpdatedBy: row.last_updated_by_type
  };
  if (includeCustomer) {
    profile.customer = {
      customerId: Number(row.customer_id),
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone
    };
  }
  return profile;
}

function shapeAdminSummary(row) {
  return {
    profileId: Number(row.profile_id),
    garmentCategory: row.garment_category,
    profileName: row.profile_name,
    unitPreference: row.unit_preference,
    fittingPreference: row.fitting_preference,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    lastUpdatedBy: row.last_updated_by_type,
    customer: {
      customerId: Number(row.customer_id),
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone
    }
  };
}

async function withTransaction(pool, callback) {
  const connection = await pool.getConnection();
  let transactionState = "clean";
  let destroyConnection = false;
  try {
    transactionState = "uncertain";
    await connection.beginTransaction();
    transactionState = "active";
    const result = await callback(connection);
    transactionState = "committing";
    await connection.commit();
    transactionState = "clean";
    return result;
  } catch (error) {
    if (transactionState === "active" || transactionState === "uncertain") {
      try {
        await connection.rollback();
        transactionState = "clean";
      } catch (rollbackError) {
        destroyConnection = true;
        console.error("Measurement profile rollback failed:", rollbackError.code || "database error");
      }
    } else if (transactionState === "committing") {
      destroyConnection = true;
    }
    throw error;
  } finally {
    if (destroyConnection) {
      connection.destroy();
    } else {
      connection.release();
    }
  }
}

async function selectProfile(executor, profileId, customerId, forUpdate = false) {
  const ownerClause = customerId === null ? "" : " AND p.customer_id = ?";
  const parameters = customerId === null ? [profileId] : [profileId, customerId];
  const [rows] = await executor.execute(
    `SELECT p.profile_id, p.customer_id, p.garment_category, p.profile_name,
            p.unit_preference, p.fitting_preference, p.notes,
            p.last_updated_by_type, p.last_updated_by_id, p.created_at, p.updated_at,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM customer_measurement_profiles p
     JOIN customers c ON c.customer_id = p.customer_id
     WHERE p.profile_id = ?${ownerClause}
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    parameters
  );
  return rows[0] || null;
}

async function selectValues(executor, profileIds) {
  if (!profileIds.length) return [];
  const placeholders = profileIds.map(() => "?").join(", ");
  const [rows] = await executor.execute(
    `SELECT profile_id, measurement_key, value_cm
     FROM customer_measurement_values
     WHERE profile_id IN (${placeholders})
     ORDER BY profile_id, measurement_key`,
    profileIds
  );
  return rows;
}

function groupValues(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const profileId = Number(row.profile_id);
    if (!grouped.has(profileId)) grouped.set(profileId, []);
    grouped.get(profileId).push(row);
  }
  return grouped;
}

async function insertValues(executor, profileId, measurementsCm) {
  const entries = Object.entries(measurementsCm);
  const tuples = entries.map(() => "(?, ?, ?)").join(", ");
  const parameters = entries.flatMap(([field, valueCm]) => [profileId, field, valueCm]);
  await executor.execute(
    `INSERT INTO customer_measurement_values (profile_id, measurement_key, value_cm)
     VALUES ${tuples}`,
    parameters
  );
}

async function createCustomerMeasurementProfile(pool, customerId, body) {
  const input = validateCreateInput(body);
  return withTransaction(pool, async (connection) => {
    const [customers] = await connection.execute(
      "SELECT customer_id FROM customers WHERE customer_id = ? FOR UPDATE",
      [customerId]
    );
    if (!customers[0]) {
      throw new RequestError(404, "The customer account was not found.");
    }

    const [profiles] = await connection.execute(
      `SELECT profile_id
       FROM customer_measurement_profiles
       WHERE customer_id = ?
       FOR UPDATE`,
      [customerId]
    );
    if (profiles.length >= MAX_PROFILES_PER_CUSTOMER) {
      throw new RequestError(409, "You can save up to 20 measurement profiles.");
    }

    const [result] = await connection.execute(
      `INSERT INTO customer_measurement_profiles
         (customer_id, garment_category, profile_name, unit_preference,
          fitting_preference, notes, last_updated_by_type, last_updated_by_id)
       VALUES (?, ?, ?, ?, ?, ?, 'CUSTOMER', ?)`,
      [
        customerId,
        input.garmentCategory,
        input.profileName,
        input.unitPreference,
        input.fittingPreference,
        input.notes,
        customerId
      ]
    );
    const profileId = Number(result.insertId);
    await insertValues(connection, profileId, input.measurementsCm);
    const row = await selectProfile(connection, profileId, customerId);
    const values = await selectValues(connection, [profileId]);
    return shapeProfile(row, values);
  });
}

async function listCustomerMeasurementProfiles(pool, customerId) {
  const [rows] = await pool.execute(
    `SELECT p.profile_id, p.customer_id, p.garment_category, p.profile_name,
            p.unit_preference, p.fitting_preference, p.notes,
            p.last_updated_by_type, p.last_updated_by_id, p.created_at, p.updated_at,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM customer_measurement_profiles p
     JOIN customers c ON c.customer_id = p.customer_id
     WHERE p.customer_id = ?
     ORDER BY p.updated_at DESC, p.profile_id DESC`,
    [customerId]
  );
  const values = groupValues(await selectValues(pool, rows.map((row) => Number(row.profile_id))));
  return rows.map((row) => shapeProfile(row, values.get(Number(row.profile_id)) || []));
}

async function getCustomerMeasurementProfile(pool, customerId, rawProfileId) {
  const profileId = validateProfileId(rawProfileId);
  const row = await selectProfile(pool, profileId, customerId);
  if (!row) throw new RequestError(404, "The measurement profile was not found.");
  const values = await selectValues(pool, [profileId]);
  return shapeProfile(row, values);
}

async function updateMeasurementProfile(pool, rawProfileId, customerId, body, actor) {
  const profileId = validateProfileId(rawProfileId);
  return withTransaction(pool, async (connection) => {
    const existing = await selectProfile(connection, profileId, customerId, true);
    if (!existing) throw new RequestError(404, "The measurement profile was not found.");
    const input = validateUpdateInput(body, existing);
    await connection.execute(
      `UPDATE customer_measurement_profiles
       SET garment_category = ?, profile_name = ?, unit_preference = ?,
           fitting_preference = ?, notes = ?, last_updated_by_type = ?,
           last_updated_by_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE profile_id = ? AND customer_id = ?`,
      [
        input.garmentCategory,
        input.profileName,
        input.unitPreference,
        input.fittingPreference,
        input.notes,
        actor.type,
        actor.id,
        profileId,
        existing.customer_id
      ]
    );
    if (input.measurementsProvided) {
      await connection.execute(
        "DELETE FROM customer_measurement_values WHERE profile_id = ?",
        [profileId]
      );
      await insertValues(connection, profileId, input.measurementsCm);
    }
    const row = await selectProfile(connection, profileId, existing.customer_id);
    const values = await selectValues(connection, [profileId]);
    return shapeProfile(row, values);
  });
}

async function deleteCustomerMeasurementProfile(pool, customerId, rawProfileId) {
  const profileId = validateProfileId(rawProfileId);
  const [result] = await pool.execute(
    `DELETE FROM customer_measurement_profiles
     WHERE profile_id = ? AND customer_id = ?`,
    [profileId, customerId]
  );
  if (result.affectedRows !== 1) {
    throw new RequestError(404, "The measurement profile was not found.");
  }
  return { profileId };
}

async function getAdminMeasurementProfile(pool, rawProfileId) {
  const profileId = validateProfileId(rawProfileId);
  const row = await selectProfile(pool, profileId, null);
  if (!row) throw new RequestError(404, "The measurement profile was not found.");
  const values = await selectValues(pool, [profileId]);
  return shapeProfile(row, values, true);
}

async function listAdminMeasurementProfiles(pool, searchParams) {
  const page = validatePage(searchParams.get("page"));
  const pageSize = validatePageSize(searchParams.get("pageSize"));
  const search = searchParams.get("search") || "";
  if (search.length > 100) {
    throw new RequestError(400, "Search text must be at most 100 characters.");
  }
  const garmentCategory = searchParams.get("garmentCategory") || "";
  if (garmentCategory) validateCategory(garmentCategory);

  const clauses = [];
  const values = [];
  if (search.trim()) {
    clauses.push("LOWER(CONCAT_WS(' ', c.name, c.email, c.phone, p.profile_name)) LIKE ?");
    values.push(`%${search.trim().toLowerCase()}%`);
  }
  if (garmentCategory) {
    clauses.push("p.garment_category = ?");
    values.push(garmentCategory);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total
     FROM customer_measurement_profiles p
     JOIN customers c ON c.customer_id = p.customer_id
     ${where}`,
    values
  );
  const total = Number(countRows[0].total);
  const offset = (page - 1) * pageSize;
  const [rows] = await pool.execute(
    `SELECT p.profile_id, p.customer_id, p.garment_category, p.profile_name,
            p.unit_preference, p.fitting_preference, p.last_updated_by_type,
            p.created_at, p.updated_at,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM customer_measurement_profiles p
     JOIN customers c ON c.customer_id = p.customer_id
     ${where}
     ORDER BY p.updated_at DESC, p.profile_id DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    values
  );
  return {
    profiles: rows.map(shapeAdminSummary),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}

module.exports = {
  GARMENT_CATEGORIES,
  MAX_PROFILES_PER_CUSTOMER,
  MEASUREMENT_FIELDS,
  createCustomerMeasurementProfile,
  deleteCustomerMeasurementProfile,
  getAdminMeasurementProfile,
  getCustomerMeasurementProfile,
  listAdminMeasurementProfiles,
  listCustomerMeasurementProfiles,
  updateMeasurementProfile
};
