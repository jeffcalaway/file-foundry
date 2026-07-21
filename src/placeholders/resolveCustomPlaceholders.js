'use strict';

const { replacePlaceholders } = require('./replacePlaceholders');

/**
 * Resolve requested custom values with a controlled depth-first dependency walk.
 *
 * @param {Record<string, {value: string}>} definitions
 * @param {Record<string, string>} builtInContext
 * @param {Record<string, string>} promptValues
 * @param {string[]} requestedKeys
 * @returns {Record<string, string>}
 */
function resolveCustomPlaceholders(definitions, builtInContext, promptValues, requestedKeys) {
  const resolved = {};
  const active = [];

  function resolveKey(key) {
    if (Object.prototype.hasOwnProperty.call(resolved, key)) {
      return resolved[key];
    }
    if (!Object.prototype.hasOwnProperty.call(definitions, key)) {
      throw new Error(`Undefined custom placeholder ${JSON.stringify(key)}.`);
    }
    if (active.includes(key)) {
      const start = active.indexOf(key);
      throw new Error(`Circular custom placeholder dependency: ${[...active.slice(start), key].join(' → ')}.`);
    }

    active.push(key);
    const source = `blueprint.json placeholders.${key}.value`;
    const value = replacePlaceholders(definitions[key].value, builtInContext, source, (parsed) => {
      if (parsed.namespace === 'BuiltIn') {
        return builtInContext[parsed.key];
      }
      if (parsed.namespace === 'Prompt') {
        if (!Object.prototype.hasOwnProperty.call(promptValues, parsed.key)) {
          throw new Error(`Undefined or unanswered prompt ${JSON.stringify(parsed.key)}.`);
        }
        const promptValue = promptValues[parsed.key];
        if (!parsed.field) return promptValue;
        if (!promptValue || typeof promptValue !== 'object' || Array.isArray(promptValue) ||
            !Object.prototype.hasOwnProperty.call(promptValue, parsed.field)) {
          throw new Error(`Prompt ${JSON.stringify(parsed.key)} has no field ${JSON.stringify(parsed.field)}.`);
        }
        const fieldValue = promptValue[parsed.field];
        return fieldValue === null ? '' : String(fieldValue);
      }
      return resolveKey(parsed.key);
    });
    active.pop();
    resolved[key] = value;
    return value;
  }

  for (const key of requestedKeys) {
    resolveKey(key);
  }
  return resolved;
}

module.exports = { resolveCustomPlaceholders };
