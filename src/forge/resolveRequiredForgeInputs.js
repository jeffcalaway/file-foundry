'use strict';

const {
  collectionSourceCustomKeys,
  collectionSourcePromptKeys,
  expandCollectionDependencies
} = require('../collections/collectionDependencies');
const { resolveCollections } = require('../collections/resolveCollections');
const { resolveCustomPlaceholders } = require('../placeholders/resolveCustomPlaceholders');
const { collectPromptValues } = require('../prompts/collectPromptValues');
const { analyzeTemplateDependencies } = require('../templates/analyzeTemplateDependencies');

/**
 * Resolve condition expressions and reachable branch bodies in dependency stages.
 * @param {object} options
 */
async function resolveRequiredForgeInputs(options) {
  const initial = options.initialInputs || {};
  const state = {
    builtIns: options.builtInContext,
    prompts: { ...(initial.prompts || {}) },
    rawPrompts: { ...(initial.rawPrompts || {}) },
    collections: { ...(initial.collections || {}) },
    custom: { ...(initial.custom || {}) },
    outputs: Object.fromEntries(options.manifest.fileSelection.options.map((option) => [
      option.key,
      (options.selectedOutputKeys || []).includes(option.key)
    ]))
  };
  for (let stage = 1; stage <= 100; stage += 1) {
    const requirements = expandCollectionDependencies(
      analyzeTemplateDependencies(options.inspectedSources, options.manifest, state),
      options.manifest
    );
    const missingCollections = [...requirements.collectionKeys]
      .filter((key) => !Object.prototype.hasOwnProperty.call(state.collections, key));
    let progressed = false;

    const readyCollections = missingCollections.filter((key) =>
      collectionSourcePromptKeys([key], options.manifest.collections, options.manifest.placeholders)
        .every((promptKey) => Object.prototype.hasOwnProperty.call(state.prompts, promptKey))
    );
    if (readyCollections.length > 0) {
      const sourceCustomKeys = collectionSourceCustomKeys(readyCollections, options.manifest.collections);
      const sourceCustom = resolveCustomPlaceholders(
        options.manifest.placeholders,
        options.builtInContext,
        state.prompts,
        sourceCustomKeys
      );
      Object.assign(state.custom, sourceCustom);
      const resolved = await resolveCollections(readyCollections, options.manifest.collections, {
        ...options.collectionContext,
        placeholderContext: {
          ...options.builtInContext,
          Custom: state.custom,
          Prompt: state.prompts
        }
      });
      Object.assign(state.collections, resolved);
      progressed = true;
    }

    const missingPrompts = options.manifest.prompts.filter((prompt) =>
      requirements.promptKeys.has(prompt.key) && !Object.prototype.hasOwnProperty.call(state.prompts, prompt.key)
    );
    const readyPrompts = missingPrompts.filter((prompt) =>
      prompt.type !== 'selectFromCollection' || Object.prototype.hasOwnProperty.call(state.collections, prompt.collection)
    );
    if (readyPrompts.length > 0) {
      const values = await collectPromptValues(
        options.vscode,
        readyPrompts,
        options.builtInContext,
        options.promptContext,
        state.collections,
        state.rawPrompts
      );
      if (values === undefined) return undefined;
      Object.assign(state.prompts, values);
      progressed = true;
    }

    const missingCustom = [...requirements.customKeys]
      .filter((key) => !Object.prototype.hasOwnProperty.call(state.custom, key));
    if (missingCustom.length > 0) {
      const values = resolveCustomPlaceholders(
        options.manifest.placeholders,
        options.builtInContext,
        state.prompts,
        missingCustom
      );
      Object.assign(state.custom, values);
      progressed = true;
    }

    options.log?.(
      `Conditional dependency stage ${stage}: collections=${readyCollections.length}/${missingCollections.length}, ` +
      `prompts=${readyPrompts.length}/${missingPrompts.length}, custom=${missingCustom.length}.`
    );
    if (!progressed) {
      if (missingCollections.length || missingPrompts.length || missingCustom.length) {
        throw new Error('Blueprint collection and prompt dependencies could not be resolved. Check for a dependency cycle.');
      }
      return state;
    }
  }
  throw new Error('Conditional dependency resolution exceeded its safe stage limit.');
}

module.exports = { resolveRequiredForgeInputs };
