'use strict';

const { evaluateCondition } = require('../conditions/evaluateCondition');
const { resolveConditionReference } = require('../conditions/resolveConditionReference');
const { scanPlaceholders } = require('../placeholders/scanPlaceholders');

class PendingDependency extends Error {}

/** @param {object[]} inspectedEntries @param {object} manifest @param {object} state */
function analyzeTemplateDependencies(inspectedEntries, manifest, state) {
  const requirements = { promptKeys: new Set(), collectionKeys: new Set(), customKeys: new Set() };
  const promptDefinitions = Object.fromEntries(manifest.prompts.map((prompt) => [prompt.key, prompt]));

  for (const entry of inspectedEntries) {
    for (const match of entry.pathPlaceholderMatches || (entry.template ? [] : entry.placeholderMatches || [])) {
      includePlaceholder(match.parsed, entry.relativePath);
    }
    if (entry.template) visitNodes(entry.template.root.children, {}, entry.template);
  }
  expandCustomDependencies(requirements, manifest, state);
  for (const key of [...requirements.promptKeys]) {
    const prompt = promptDefinitions[key];
    if (prompt?.type === 'selectFromCollection') requirements.collectionKeys.add(prompt.collection);
  }
  return requirements;

  function visitNodes(nodes, scopes, template) {
    for (const node of nodes) {
      if (node.type === 'text' || node.type === 'alias') continue;
      if (node.type === 'expression') {
        if (node.parseError) {
          const message = node.aliasMatch
            ? `Alias ${node.aliasMatch[1]} is used outside its loop scope`
            : node.parseError;
          throw locatedError(message, node, template);
        }
        includePlaceholder(node.parsed, template.sourcePath);
        continue;
      }
      if (node.type === 'each') {
        const records = resolveLoopSource(node, template);
        if (!records) continue;
        records.forEach((record, index) => visitNodes(node.children, {
          ...scopes,
          [node.alias]: { record, index, count: records.length }
        }, template));
        continue;
      }
      visitConditional(node, scopes, template);
    }
  }

  function resolveLoopSource(node, template) {
    if (node.sourceType === 'Collection') {
      if (!Object.prototype.hasOwnProperty.call(manifest.collections, node.sourceKey)) {
        throw locatedError(`Unknown collection ${JSON.stringify(node.sourceKey)}`, node, template);
      }
      if (!Object.prototype.hasOwnProperty.call(state.collections, node.sourceKey)) {
        requirements.collectionKeys.add(node.sourceKey);
        return undefined;
      }
      return state.collections[node.sourceKey];
    }
    const prompt = promptDefinitions[node.sourceKey];
    if (!prompt) throw locatedError(`Unknown prompt ${JSON.stringify(node.sourceKey)}`, node, template);
    if (prompt.type !== 'selectFromCollection' || prompt.selection.mode !== 'multi') {
      throw locatedError(`Prompt ${JSON.stringify(node.sourceKey)} is not a multi-select collection prompt and cannot be looped over`, node, template);
    }
    if (!Object.prototype.hasOwnProperty.call(state.prompts, node.sourceKey)) {
      requirements.promptKeys.add(node.sourceKey);
      requirements.collectionKeys.add(prompt.collection);
      return undefined;
    }
    return state.prompts[node.sourceKey];
  }

  function visitConditional(node, scopes, template) {
    for (const branch of node.branches) {
      if (branch.condition === null) { visitNodes(branch.children, scopes, template); return; }
      try {
        const matched = evaluateCondition(branch.condition, (reference) => resolveConditionReference(reference, {
          builtIns: state.builtIns,
          prompts: state.prompts,
          rawPrompts: state.rawPrompts,
          collections: state.collections,
          custom: state.custom,
          scopes,
          promptDefinitions,
          collectionDefinitions: manifest.collections,
          customDefinitions: manifest.placeholders,
          outputs: state.outputs,
          outputDefinitions: Object.fromEntries(manifest.fileSelection.options.map((option) => [option.key, option])),
          onMissing(type, key) {
            requirements[`${type}Keys`].add(key);
            throw new PendingDependency();
          }
        }));
        if (matched) { visitNodes(branch.children, scopes, template); return; }
      } catch (error) {
        if (error instanceof PendingDependency) return;
        throw locatedError(`Condition ${JSON.stringify(branch.expression)} failed: ${error.message}`, branch, template);
      }
    }
  }

  function includePlaceholder(parsed, source) {
    if (parsed.namespace === 'BuiltIn') return;
    if (parsed.namespace === 'Custom') {
      if (!Object.prototype.hasOwnProperty.call(manifest.placeholders, parsed.key)) {
        throw new Error(`Undefined custom placeholder ${JSON.stringify(parsed.key)} referenced by ${source}.`);
      }
      requirements.customKeys.add(parsed.key);
      return;
    }
    const prompt = promptDefinitions[parsed.key];
    if (!prompt) throw new Error(`Undefined prompt ${JSON.stringify(parsed.key)} referenced by ${source}.`);
    validatePromptPlaceholder(prompt, parsed, source);
    requirements.promptKeys.add(parsed.key);
  }
}

/** @param {object} requirements @param {object} manifest @param {object} state */
function expandCustomDependencies(requirements, manifest, state) {
  const visited = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const definition = manifest.placeholders[key];
    if (!definition) throw new Error(`Undefined custom placeholder ${JSON.stringify(key)}.`);
    requirements.customKeys.add(key);
    for (const match of scanPlaceholders(definition.value, `blueprint.json placeholders.${key}.value`)) {
      if (match.parsed.namespace === 'Custom') visit(match.parsed.key);
      if (match.parsed.namespace === 'Prompt') {
        const prompt = manifest.prompts.find((item) => item.key === match.parsed.key);
        if (!prompt) throw new Error(`Undefined prompt ${JSON.stringify(match.parsed.key)} referenced by custom placeholder ${JSON.stringify(key)}.`);
        validatePromptPlaceholder(prompt, match.parsed, `custom placeholder ${JSON.stringify(key)}`);
        if (!Object.prototype.hasOwnProperty.call(state.prompts, match.parsed.key)) {
          requirements.promptKeys.add(match.parsed.key);
        }
      }
    }
  }
  for (const key of [...requirements.customKeys]) visit(key);
}

/** @param {object} prompt @param {object} parsed @param {string} source */
function validatePromptPlaceholder(prompt, parsed, source) {
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

/** @param {string} message @param {object} node @param {object} template */
function locatedError(message, node, template) {
  const location = node.location || { line: 1, column: 1 };
  const prefix = template.blueprintName ? `Blueprint “${template.blueprintName}”, ` : '';
  return new Error(`${prefix}source ${template.sourcePath}:${location.line}:${location.column}: ${message}.`);
}

module.exports = { analyzeTemplateDependencies, expandCustomDependencies, PendingDependency };
