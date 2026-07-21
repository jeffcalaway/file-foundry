'use strict';

const RESERVED_FIELDS = new Set(['match', 'matchIndex']);

/** @param {{content: string, options?: object}} input */
async function regexExtractor({ content, options = {} }) {
  if (typeof options.pattern !== 'string') {
    throw new Error('fileFoundry.regex requires a string options.pattern.');
  }
  const requestedFlags = options.flags ?? '';
  if (typeof requestedFlags !== 'string' || /[^dgimsuvy]/u.test(requestedFlags) || new Set(requestedFlags).size !== requestedFlags.length) {
    throw new Error(`Invalid regular expression flags: ${JSON.stringify(requestedFlags)}.`);
  }
  const flags = requestedFlags.includes('g') ? requestedFlags : `${requestedFlags}g`;
  let expression;
  try {
    expression = new RegExp(options.pattern, flags);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error.message}`);
  }
  const records = [];
  const uniqueBy = options.uniqueBy;
  if (uniqueBy !== undefined && (typeof uniqueBy !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/u.test(uniqueBy))) {
    throw new Error('fileFoundry.regex options.uniqueBy must be a record field identifier.');
  }
  const seenUniqueValues = new Set();
  const namedIndexes = findNamedCaptureIndexes(options.pattern);
  let match;
  while ((match = expression.exec(content)) !== null) {
    const record = { match: match[0], matchIndex: match.index };
    for (let index = 1; index < match.length; index += 1) {
      if (!namedIndexes.has(index)) record[`group${index}`] = match[index] ?? '';
    }
    for (const [name, value] of Object.entries(match.groups || {})) {
      if (RESERVED_FIELDS.has(name) || !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name) || Object.prototype.hasOwnProperty.call(record, name)) {
        throw new Error(`Regex capture group ${JSON.stringify(name)} is reserved, duplicate, or unsafe.`);
      }
      record[name] = value ?? '';
    }
    if (uniqueBy) {
      if (!Object.prototype.hasOwnProperty.call(record, uniqueBy)) {
        throw new Error(`fileFoundry.regex options.uniqueBy field ${JSON.stringify(uniqueBy)} is missing from a result.`);
      }
      const uniqueValue = record[uniqueBy];
      if (seenUniqueValues.has(uniqueValue)) continue;
      seenUniqueValues.add(uniqueValue);
    }
    records.push(record);
    if (match[0].length === 0) {
      expression.lastIndex += 1;
    }
  }
  return records;
}

/** Return the JavaScript capture indexes occupied by named groups. @param {string} pattern */
function findNamedCaptureIndexes(pattern) {
  const named = new Set();
  let captureIndex = 0;
  let escaped = false;
  let characterClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '[') { characterClass = true; continue; }
    if (character === ']' && characterClass) { characterClass = false; continue; }
    if (character !== '(' || characterClass) continue;
    if (pattern[index + 1] !== '?') { captureIndex += 1; continue; }
    if (pattern[index + 2] === '<' && !['=', '!'].includes(pattern[index + 3])) {
      captureIndex += 1;
      named.add(captureIndex);
    }
  }
  return named;
}

module.exports = { findNamedCaptureIndexes, regexExtractor };
