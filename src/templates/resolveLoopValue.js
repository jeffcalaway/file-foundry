'use strict';

const LOOP_METADATA = Object.freeze(['@index', '@number', '@first', '@last', '@count']);

/** @param {Record<string, object>} scopes @param {string} alias @param {string} field */
function resolveLoopValue(scopes, alias, field) {
  const scope = scopes[alias];
  if (!scope) throw new Error(`Alias ${alias} is used outside its loop scope.`);
  const metadata = {
    '@index': scope.index,
    '@number': scope.index + 1,
    '@first': scope.index === 0,
    '@last': scope.index === scope.count - 1,
    '@count': scope.count
  };
  if (field.startsWith('@')) {
    if (!LOOP_METADATA.includes(field)) throw new Error(`Unknown loop metadata ${field}.`);
    return metadata[field];
  }
  if (!scope.record || typeof scope.record !== 'object' || !Object.prototype.hasOwnProperty.call(scope.record, field)) {
    throw new Error(`Record for alias ${alias} has no field ${JSON.stringify(field)}.`);
  }
  return scope.record[field];
}

module.exports = { LOOP_METADATA, resolveLoopValue };
