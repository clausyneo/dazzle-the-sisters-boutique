"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildMeasurementPatch,
  formatRange,
  isWithinRange,
  rangeInUnit
} = require("../frontend/js/measurement-profile-editor");

test("frontend range helpers convert and format limits without changing canonical centimetres", () => {
  assert.deepEqual(rangeInUnit([40, 200], "cm"), [40, 200]);
  assert.deepEqual(rangeInUnit([40, 200], "in"), [15.75, 78.74]);
  assert.equal(formatRange([40, 200], "in"), "15.75–78.74 in");
  assert.equal(isWithinRange(40, [40, 200]), true);
  assert.equal(isWithinRange(200.001, [40, 200]), false);
});

test("metadata and unit-only edits preserve stored measurement precision", () => {
  const patch = buildMeasurementPatch({
    editing: true,
    originalCategory: "KURTI",
    category: "KURTI",
    measurementsDirty: false,
    measurementsCm: { bust: 91.441, waist: 82.555 },
    fields: ["bust", "waist"],
    unit: "in"
  });

  assert.equal(patch, undefined);
});

test("a measurement edit sends only changed fields in the selected unit", () => {
  const patch = buildMeasurementPatch({
    editing: true,
    originalCategory: "KURTI",
    category: "KURTI",
    measurementsDirty: true,
    changedFields: new Set(["waist"]),
    measurementsCm: { bust: 91.44, waist: 82.55 },
    fields: ["bust", "waist", "hip"],
    unit: "in"
  });

  assert.deepEqual(patch, { waist: 32.5 });
});

test("new profiles and category changes include measurement values", () => {
  const measurementsCm = { bust: 91.44 };
  const fields = ["bust"];
  const createPatch = buildMeasurementPatch({
    editing: false,
    originalCategory: null,
    category: "KURTI",
    measurementsDirty: false,
    changedFields: new Set(),
    measurementsCm,
    fields,
    unit: "in"
  });
  const categoryPatch = buildMeasurementPatch({
    editing: true,
    originalCategory: "BLOUSE",
    category: "KURTI",
    measurementsDirty: false,
    changedFields: new Set(),
    measurementsCm,
    fields,
    unit: "cm"
  });

  assert.deepEqual(createPatch, { bust: 36 });
  assert.deepEqual(categoryPatch, { bust: 91.44 });
});
