'use strict';

const { parsePlaceholder, PlaceholderError } = require('./parsePlaceholder');

class LocatedPlaceholderError extends Error {
  /** @param {string} message @param {string} sourceRelativePath @param {string} expression */
  constructor(message, sourceRelativePath, expression) {
    super(`${message} Source: ${sourceRelativePath}.`);
    this.name = 'LocatedPlaceholderError';
    this.sourceRelativePath = sourceRelativePath;
    this.expression = expression;
  }
}

/**
 * Find and validate every File Foundry expression in a string.
 *
 * @param {string} input
 * @param {string} [sourceRelativePath]
 * @returns {Array<{start: number, end: number, parsed: ReturnType<typeof parsePlaceholder>} >}
 */
function scanPlaceholders(input, sourceRelativePath = '<value>') {
  const matches = [];
  let cursor = 0;

  while (cursor < input.length) {
    const opening = input.indexOf('[[', cursor);
    if (opening === -1) {
      break;
    }
    const closing = input.indexOf(']]', opening + 2);
    if (closing === -1) {
      const expression = input.slice(opening, Math.min(input.length, opening + 80));
      throw new LocatedPlaceholderError(
        `Malformed placeholder ${JSON.stringify(expression)}: missing closing brackets.`,
        sourceRelativePath,
        expression
      );
    }

    const expression = input.slice(opening, closing + 2);
    if (expression.slice(2, -2).includes('[[')) {
      throw new LocatedPlaceholderError(
        `Malformed placeholder ${JSON.stringify(expression)}`,
        sourceRelativePath,
        expression
      );
    }

    try {
      matches.push({
        start: opening,
        end: closing + 2,
        parsed: parsePlaceholder(expression)
      });
    } catch (error) {
      if (error instanceof PlaceholderError) {
        throw new LocatedPlaceholderError(error.message, sourceRelativePath, error.expression);
      }
      throw error;
    }
    cursor = closing + 2;
  }

  return matches;
}

module.exports = { LocatedPlaceholderError, scanPlaceholders };
