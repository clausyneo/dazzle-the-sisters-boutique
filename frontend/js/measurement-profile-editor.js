(function exposeMeasurementProfileEditor(root, factory) {
  const editor = factory();
  if (typeof module === "object" && module.exports) module.exports = editor;
  if (root) root.DAZZLE_MEASUREMENT_PROFILE_EDITOR = editor;
})(typeof window === "undefined" ? globalThis : window, function createMeasurementProfileEditor() {
  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function fromCentimeters(value, unit) {
    return unit === "in" ? value / 2.54 : value;
  }

  function rangeInUnit(range, unit) {
    if (unit !== "in") return range;
    return [
      Math.ceil((range[0] / 2.54) * 100) / 100,
      Math.floor((range[1] / 2.54) * 100) / 100
    ];
  }

  function isWithinRange(valueCm, range) {
    return Number.isFinite(valueCm) && valueCm >= range[0] && valueCm <= range[1];
  }

  function formatRange(range, unit) {
    const [minimum, maximum] = rangeInUnit(range, unit);
    const format = (value) => Number(value.toFixed(2)).toString();
    return `${format(minimum)}–${format(maximum)} ${unit}`;
  }

  function buildMeasurementPatch({
    editing,
    originalCategory,
    category,
    measurementsDirty,
    changedFields,
    measurementsCm,
    fields,
    unit
  }) {
    if (editing && category === originalCategory && !measurementsDirty) return undefined;

    const patch = {};
    for (const field of fields) {
      if (editing && category === originalCategory && !changedFields.has(field)) continue;
      if (!hasOwn(measurementsCm, field)) continue;
      patch[field] = Number(fromCentimeters(measurementsCm[field], unit).toFixed(2));
    }
    return patch;
  }

  return { buildMeasurementPatch, formatRange, isWithinRange, rangeInUnit };
});
