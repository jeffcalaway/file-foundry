'use strict';

/** @param {unknown} value */
function conditionTruthiness(value) {
  if (value === false || value === null) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return true;
  if (value === true) return true;
  throw new Error(`Unsupported conditional value type ${typeof value}.`);
}

module.exports = { conditionTruthiness };
