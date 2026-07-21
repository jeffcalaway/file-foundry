'use strict';

const { evaluateCondition } = require('../conditions/evaluateCondition');
const { resolveConditionReference } = require('../conditions/resolveConditionReference');
const { applyTransform } = require('../placeholders/transforms');
const { resolveLoopValue } = require('./resolveLoopValue');

/** @param {object} parsedTemplate @param {object} values */
function renderTemplate(parsedTemplate, values) {
  return renderNodes(parsedTemplate.root.children, {});

  function renderNodes(nodes, scopes) {
    return nodes.map((node) => {
      if (node.type === 'text') return node.value;
      if (node.type === 'expression') {
        if (node.parseError) {
          const message = node.aliasMatch
            ? `Alias ${node.aliasMatch[1]} is used outside its loop scope`
            : node.parseError;
          throw locatedError(message, node);
        }
        return node.raw;
      }
      if (node.type === 'alias') return renderAlias(node, scopes);
      if (node.type === 'conditional') return renderConditional(node, scopes);
      const records = node.sourceType === 'Collection' ? values.collections[node.sourceKey] : values.prompts[node.sourceKey];
      if (!Array.isArray(records)) throw locatedError(`${node.sourceType}:${node.sourceKey} is not a collection and cannot be looped over`, node);
      return records.map((record, index) => renderNodes(node.children, {
        ...scopes,
        [node.alias]: { record, index, count: records.length }
      })).join('');
    }).join('');
  }

  function renderConditional(node, scopes) {
    for (const branch of node.branches) {
      if (branch.condition === null) return renderNodes(branch.children, scopes);
      let matches;
      try {
        matches = evaluateCondition(branch.condition, (reference) => resolveConditionReference(reference, {
          builtIns: values.builtIns || {},
          prompts: values.prompts || {},
          rawPrompts: values.rawPrompts || {},
          collections: values.collections || {},
          custom: values.custom || {},
          scopes,
          promptDefinitions: values.promptDefinitions,
          collectionDefinitions: values.collectionDefinitions,
          customDefinitions: values.customDefinitions,
          outputs: values.outputs,
          outputDefinitions: values.outputDefinitions,
          onMissing(type, key) { throw new Error(`Unresolved ${type} ${JSON.stringify(key)} in conditional expression.`); }
        }));
      } catch (error) {
        throw locatedError(`Condition ${JSON.stringify(branch.expression)} failed: ${error.message}`, branch);
      }
      if (matches) return renderNodes(branch.children, scopes);
    }
    return '';
  }

  function locatedError(message, node) {
    const location = node.location || { line: 1, column: 1 };
    const prefix = parsedTemplate.blueprintName ? `Blueprint “${parsedTemplate.blueprintName}”, ` : '';
    return new Error(`${prefix}source ${parsedTemplate.sourcePath || '<template>'}:${location.line}:${location.column}: ${message}.`);
  }
}

/** @param {object} node @param {Record<string, object>} scopes */
function renderAlias(node, scopes) {
  const value = resolveLoopValue(scopes, node.alias, node.field);
  const rendered = value === null ? '' : String(value);
  return node.transform ? applyTransform(node.transform, rendered) : rendered;
}

module.exports = { renderAlias, renderTemplate };
