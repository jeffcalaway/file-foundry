'use strict';

/**
 * Split a value into consistent word tokens for every supported case transform.
 * Acronym boundaries, case changes, separators, and numeric segments are kept
 * predictable without discarding digits.
 *
 * @param {string} value
 * @returns {string[]}
 */
function tokenizeWords(value) {
  return String(value)
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[\s._-]+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

module.exports = { tokenizeWords };
