'use strict';

const { scanPlaceholders } = require('../placeholders/scanPlaceholders');

/** @param {string[]} collectionKeys @param {Record<string, object>} definitions */
function collectionSourceCustomKeys(collectionKeys, definitions) {
  const keys = new Set();
  for (const name of collectionKeys) {
    for (const match of scanPlaceholders(definitions[name].source.path, `collection ${name} source`)) {
      if (match.parsed.namespace === 'Custom') keys.add(match.parsed.key);
    }
  }
  return [...keys];
}

/**
 * Return every prompt needed to resolve the requested collection source paths,
 * including prompts reached through custom placeholders.
 *
 * @param {string[]} collectionKeys
 * @param {Record<string, object>} definitions
 * @param {Record<string, {value: string}>} placeholders
 */
function collectionSourcePromptKeys(collectionKeys, definitions, placeholders) {
  const keys = new Set();
  const visitedCustom = new Set();

  function visitCustom(key) {
    if (visitedCustom.has(key)) return;
    visitedCustom.add(key);
    const definition = placeholders[key];
    if (!definition) return;
    for (const match of scanPlaceholders(definition.value, `custom placeholder ${key}`)) {
      if (match.parsed.namespace === 'Prompt') keys.add(match.parsed.key);
      if (match.parsed.namespace === 'Custom') visitCustom(match.parsed.key);
    }
  }

  for (const name of collectionKeys) {
    for (const match of scanPlaceholders(definitions[name].source.path, `collection ${name} source`)) {
      if (match.parsed.namespace === 'Prompt') keys.add(match.parsed.key);
      if (match.parsed.namespace === 'Custom') visitCustom(match.parsed.key);
    }
  }
  return [...keys];
}

/** Add transitive collection-source prompt dependencies to template requirements. */
function expandCollectionDependencies(requirements, manifest) {
  const promptDefinitions = Object.fromEntries(manifest.prompts.map((prompt) => [prompt.key, prompt]));
  let changed = true;
  while (changed) {
    changed = false;
    const promptKeys = collectionSourcePromptKeys(
      [...requirements.collectionKeys],
      manifest.collections,
      manifest.placeholders
    );
    for (const key of promptKeys) {
      if (!requirements.promptKeys.has(key)) {
        requirements.promptKeys.add(key);
        changed = true;
      }
    }
    for (const key of [...requirements.promptKeys]) {
      const prompt = promptDefinitions[key];
      if (prompt?.type === 'selectFromCollection' && !requirements.collectionKeys.has(prompt.collection)) {
        requirements.collectionKeys.add(prompt.collection);
        changed = true;
      }
    }
  }
  return requirements;
}

module.exports = {
  collectionSourceCustomKeys,
  collectionSourcePromptKeys,
  expandCollectionDependencies
};
