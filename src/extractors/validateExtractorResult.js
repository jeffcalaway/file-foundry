'use strict';

const RECORD_ID = Symbol('fileFoundry.extractorRecordId');

/** @param {unknown} result @param {string} extractorId */
function validateExtractorResult(result, extractorId) {
  if (!Array.isArray(result)) throw new Error(`Extractor ${extractorId} must return an array.`);
  return result.map((record, index) => {
    if (!isPlainObject(record)) throw new Error(`Extractor ${extractorId} record ${index} must be a plain object.`);
    const normalized = {};
    for (const [key, value] of Object.entries(record)) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(key) || !['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
        throw new Error(`Extractor ${extractorId} record ${index} contains invalid field ${JSON.stringify(key)}.`);
      }
      normalized[key] = value;
    }
    Object.defineProperty(normalized, RECORD_ID, {
      value: `${extractorId}:${index}`,
      enumerable: false
    });
    return normalized;
  });
}

/** @param {unknown} value */
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

module.exports = { RECORD_ID, validateExtractorResult };
