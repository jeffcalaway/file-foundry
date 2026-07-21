'use strict';

const { resolveLoopValue } = require('../templates/resolveLoopValue');

/** @param {string} reference @param {object} context */
function resolveConditionReference(reference, context) {
  if (!reference.includes(':')) {
    if (!['FolderName', 'FolderLetter', 'DirName', 'DirLetter'].includes(reference)) {
      throw new Error(`Unknown built-in conditional reference ${JSON.stringify(reference)}.`);
    }
    return context.builtIns[reference];
  }
  if (reference.startsWith('Prompt:')) return resolvePrompt(reference.slice(7), context);
  if (reference.startsWith('Collection:')) {
    const key = reference.slice(11);
    assertDeclared(context.collectionDefinitions, key, 'collection');
    if (!Object.prototype.hasOwnProperty.call(context.collections, key)) return context.onMissing?.('collection', key);
    return context.collections[key];
  }
  if (reference.startsWith('Custom:')) {
    const key = reference.slice(7);
    assertDeclared(context.customDefinitions, key, 'custom placeholder');
    if (!Object.prototype.hasOwnProperty.call(context.custom, key)) return context.onMissing?.('custom', key);
    return context.custom[key];
  }
  if (reference.startsWith('Output:')) {
    const key = reference.slice(7);
    assertDeclared(context.outputDefinitions, key, 'output option');
    return context.outputs?.[key] === true;
  }
  const separator = reference.indexOf(':');
  return resolveLoopValue(context.scopes || {}, reference.slice(0, separator), reference.slice(separator + 1));
}

/** @param {string} reference @param {object} context */
function resolvePrompt(reference, context) {
  const dot = reference.indexOf('.');
  const key = dot === -1 ? reference : reference.slice(0, dot);
  const field = dot === -1 ? undefined : reference.slice(dot + 1);
  assertDeclared(context.promptDefinitions, key, 'prompt');
  const definition = context.promptDefinitions?.[key];
  if (field && definition && definition.type !== 'selectFromCollection') {
    throw new Error(`Scalar prompt ${JSON.stringify(key)} cannot use record field syntax in a condition.`);
  }
  if (!Object.prototype.hasOwnProperty.call(context.prompts, key)) return context.onMissing?.('prompt', key);
  const renderedValue = context.prompts[key];
  if (!field) {
    return (definition?.type === 'confirm' || !definition) && Object.prototype.hasOwnProperty.call(context.rawPrompts || {}, key)
      ? context.rawPrompts[key] : renderedValue;
  }
  if (Array.isArray(renderedValue)) {
    return renderedValue.map((record) => {
      if (!record || typeof record !== 'object' || !Object.prototype.hasOwnProperty.call(record, field)) {
        throw new Error(`Prompt ${JSON.stringify(key)} has a selected record without field ${JSON.stringify(field)}.`);
      }
      return record[field];
    });
  }
  if (!renderedValue || typeof renderedValue !== 'object') throw new Error(`Prompt ${JSON.stringify(key)} has no selected record.`);
  if (!Object.prototype.hasOwnProperty.call(renderedValue, field)) {
    throw new Error(`Prompt ${JSON.stringify(key)} has no field ${JSON.stringify(field)}.`);
  }
  return renderedValue[field];
}

/** @param {Record<string, unknown> | undefined} definitions @param {string} key @param {string} label */
function assertDeclared(definitions, key, label) {
  if (definitions && !Object.prototype.hasOwnProperty.call(definitions, key)) {
    throw new Error(`Unknown ${label} ${JSON.stringify(key)} in conditional expression.`);
  }
}

module.exports = { resolveConditionReference };
