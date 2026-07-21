'use strict';

const { PLACEHOLDER_NAMES, TRANSFORM_NAMES } = require('./constants');

class PlaceholderError extends Error {
  /**
   * @param {string} message
   * @param {string} expression
   */
  constructor(message, expression) {
    super(message);
    this.name = 'PlaceholderError';
    this.expression = expression;
  }
}

/**
 * Parse one complete File Foundry placeholder expression.
 *
 * @param {string} expression
 * @returns {{placeholder: string, transform: string | undefined, expression: string}}
 */
function parsePlaceholder(expression) {
  const match = /^\[\[(?:(Custom|Prompt):)?([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?(?:>([A-Za-z][A-Za-z0-9]*))?\]\]$/.exec(expression);

  if (!match) {
    throw new PlaceholderError(
      `Malformed placeholder ${JSON.stringify(expression)}. Use [[PlaceholderName]], [[Custom:Key]], or [[Prompt:Key]], with at most one >Transformation and no spaces.`,
      expression
    );
  }

  const namespace = match[1] || 'BuiltIn';
  const key = match[2];
  const field = match[3];
  const transform = match[4];
  if (field && namespace !== 'Prompt') {
    throw new PlaceholderError(`Record field syntax is supported only for Prompt placeholders: ${JSON.stringify(expression)}.`, expression);
  }

  if (namespace === 'BuiltIn' && !PLACEHOLDER_NAMES.includes(key)) {
    throw new PlaceholderError(
      `Unknown placeholder ${JSON.stringify(expression)}. Supported placeholders: ${PLACEHOLDER_NAMES.join(', ')}.`,
      expression
    );
  }
  if (transform && !TRANSFORM_NAMES.includes(transform)) {
    throw new PlaceholderError(
      `Unknown transformation in ${JSON.stringify(expression)}. Supported transformations: ${TRANSFORM_NAMES.join(', ')}.`,
      expression
    );
  }

  const result = {
    namespace,
    key,
    placeholder: namespace === 'BuiltIn' ? key : `${namespace}:${key}${field ? `.${field}` : ''}`,
    transform,
    expression
  };
  if (field) result.field = field;
  return result;
}

module.exports = { PlaceholderError, parsePlaceholder };
