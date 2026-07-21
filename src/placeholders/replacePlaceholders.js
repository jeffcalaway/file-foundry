'use strict';

const { applyTransform } = require('./transforms');
const { LocatedPlaceholderError, scanPlaceholders } = require('./scanPlaceholders');

/**
 * Replace complete double-bracket expressions while leaving ordinary brackets
 * and unrelated syntax (including JavaScript template expressions) untouched.
 *
 * @param {string} input
 * @param {Record<string, string>} context
 * @param {string} [sourceRelativePath]
 * @param {(parsed: object) => string} [valueResolver]
 * @returns {string}
 */
function replacePlaceholders(input, context, sourceRelativePath = '<value>', valueResolver) {
  const matches = scanPlaceholders(input, sourceRelativePath);
  let cursor = 0;
  let result = '';

  for (const match of matches) {
    result += input.slice(cursor, match.start);
    try {
      const parsed = match.parsed;
      const baseValue = valueResolver
        ? valueResolver(parsed)
        : resolveContextValue(context, parsed);
      if (typeof baseValue !== 'string') {
        throw new LocatedPlaceholderError(
          `No value is available for ${parsed.placeholder}.`,
          sourceRelativePath,
          parsed.expression
        );
      }
      result += parsed.transform
        ? applyTransform(parsed.transform, baseValue)
        : baseValue;
    } catch (error) {
      if (error instanceof LocatedPlaceholderError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new LocatedPlaceholderError(error.message, sourceRelativePath, match.parsed.expression);
      }
      throw error;
    }
    cursor = match.end;
  }
  result += input.slice(cursor);
  return result;
}

/** @param {Record<string, unknown>} context @param {{namespace: string, key: string}} parsed */
function resolveContextValue(context, parsed) {
  if (parsed.namespace === 'BuiltIn') {
    return context[parsed.key];
  }
  const namespaceValues = context[parsed.namespace];
  if (!namespaceValues || typeof namespaceValues !== 'object') return undefined;
  const value = namespaceValues[parsed.key];
  if (!parsed.field) return value;
  return value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, parsed.field)
    ? scalarToString(value[parsed.field]) : undefined;
}

/** @param {unknown} value */
function scalarToString(value) {
  if (value === null) return '';
  return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : undefined;
}

module.exports = { LocatedPlaceholderError, replacePlaceholders };
