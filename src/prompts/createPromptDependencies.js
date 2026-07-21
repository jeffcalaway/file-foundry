'use strict';

const { scanPlaceholders } = require('../placeholders/scanPlaceholders');

/**
 * Follow selected-output references through custom placeholder definitions.
 *
 * @param {Array<{placeholderMatches: Array<{parsed: object}>}>} inspectedEntries
 * @param {{placeholders: Record<string, {value: string}>, prompts: Array<{key: string}>}} manifest
 * @returns {{prompts: object[], customKeys: string[], collectionKeys: string[]}}
 */
function createPromptDependencies(inspectedEntries, manifest) {
  const promptDefinitions = new Map(manifest.prompts.map((prompt) => [prompt.key, prompt]));
  const requiredPrompts = new Set();
  const requiredCustom = new Set();
  const requiredCollections = new Set();

  function includeReference(parsed, source) {
    if (parsed.namespace === 'Prompt') {
      if (!promptDefinitions.has(parsed.key)) {
        throw new Error(`Undefined prompt ${JSON.stringify(parsed.key)} referenced by ${source}.`);
      }
      requiredPrompts.add(parsed.key);
      validatePromptUsage(promptDefinitions.get(parsed.key), parsed, source);
    } else if (parsed.namespace === 'Custom') {
      includeCustom(parsed.key, source);
    }
  }

  function includeCustom(key, source) {
    if (!Object.prototype.hasOwnProperty.call(manifest.placeholders, key)) {
      throw new Error(`Undefined custom placeholder ${JSON.stringify(key)} referenced by ${source}.`);
    }
    if (requiredCustom.has(key)) {
      return;
    }
    requiredCustom.add(key);
    const definition = manifest.placeholders[key];
    for (const match of scanPlaceholders(definition.value, `blueprint.json placeholders.${key}.value`)) {
      includeReference(match.parsed, `custom placeholder ${JSON.stringify(key)}`);
    }
  }

  for (const entry of inspectedEntries) {
    for (const match of entry.placeholderMatches) {
      includeReference(match.parsed, entry.relativePath);
    }
    for (const key of entry.template?.collectionKeys || []) {
      if (!Object.prototype.hasOwnProperty.call(manifest.collections || {}, key)) {
        throw new Error(`Unknown collection ${JSON.stringify(key)} referenced by ${entry.relativePath}.`);
      }
      requiredCollections.add(key);
    }
    for (const key of entry.template?.promptKeys || []) {
      const prompt = promptDefinitions.get(key);
      if (!prompt) throw new Error(`Unknown prompt ${JSON.stringify(key)} referenced by loop in ${entry.relativePath}.`);
      if (prompt.type !== 'selectFromCollection' || prompt.selection.mode !== 'multi') {
        throw new Error(`Prompt ${JSON.stringify(key)} is not a multi-select collection prompt and cannot be looped over.`);
      }
      requiredPrompts.add(key);
    }
  }

  for (const prompt of manifest.prompts) {
    if (requiredPrompts.has(prompt.key) && prompt.type === 'selectFromCollection') requiredCollections.add(prompt.collection);
  }

  return {
    prompts: manifest.prompts.filter((prompt) => requiredPrompts.has(prompt.key)),
    customKeys: [...requiredCustom],
    collectionKeys: [...requiredCollections]
  };
}

/** @param {object} prompt @param {object} parsed @param {string} source */
function validatePromptUsage(prompt, parsed, source) {
  if (prompt.type !== 'selectFromCollection' && parsed.field) {
    throw new Error(`Scalar prompt ${JSON.stringify(prompt.key)} cannot use record field syntax in ${source}.`);
  }
  if (prompt.type === 'selectFromCollection' && prompt.selection.mode === 'multi') {
    throw new Error(`Multi-select prompt ${JSON.stringify(prompt.key)} must be consumed by a loop, not a scalar placeholder.`);
  }
  if (prompt.type === 'selectFromCollection' && prompt.selection.mode === 'single' && !parsed.field) {
    throw new Error(`Single-select prompt ${JSON.stringify(prompt.key)} must reference a record field.`);
  }
}

module.exports = { createPromptDependencies };
