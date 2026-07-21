'use strict';

/**
 * Parse already-valid JSON a second time while retaining object key occurrences.
 * JSON.parse intentionally discards duplicate keys, so this small structural
 * scanner is needed to reject ambiguous manifests.
 *
 * @param {string} source
 * @returns {string[]}
 */
function detectDuplicateJsonKeys(source) {
  const duplicates = [];
  let cursor = 0;

  function whitespace() {
    while (/\s/u.test(source[cursor] || '')) {
      cursor += 1;
    }
  }

  function stringValue() {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2;
      } else if (source[cursor] === '"') {
        cursor += 1;
        return JSON.parse(source.slice(start, cursor));
      } else {
        cursor += 1;
      }
    }
    return '';
  }

  /** @param {string} location */
  function value(location) {
    whitespace();
    if (source[cursor] === '{') {
      object(location);
    } else if (source[cursor] === '[') {
      array(location);
    } else if (source[cursor] === '"') {
      stringValue();
    } else {
      while (cursor < source.length && !/[\s,}\]]/u.test(source[cursor])) {
        cursor += 1;
      }
    }
  }

  /** @param {string} location */
  function object(location) {
    cursor += 1;
    whitespace();
    const keys = new Set();
    while (source[cursor] !== '}' && cursor < source.length) {
      const key = stringValue();
      const keyLocation = location ? `${location}.${key}` : key;
      if (keys.has(key)) {
        duplicates.push(keyLocation);
      }
      keys.add(key);
      whitespace();
      cursor += 1;
      value(keyLocation);
      whitespace();
      if (source[cursor] === ',') {
        cursor += 1;
        whitespace();
      }
    }
    cursor += 1;
  }

  /** @param {string} location */
  function array(location) {
    cursor += 1;
    whitespace();
    let index = 0;
    while (source[cursor] !== ']' && cursor < source.length) {
      value(`${location}[${index}]`);
      index += 1;
      whitespace();
      if (source[cursor] === ',') {
        cursor += 1;
        whitespace();
      }
    }
    cursor += 1;
  }

  value('');
  return duplicates;
}

module.exports = { detectDuplicateJsonKeys };
