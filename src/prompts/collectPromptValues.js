'use strict';

const { promptConfirmResult } = require('./promptConfirm');
const { promptInput } = require('./promptInput');
const { promptMultiPick } = require('./promptMultiPick');
const { promptPath } = require('./promptPath');
const { promptPick } = require('./promptPick');
const { promptSelectFromCollection } = require('./promptSelectFromCollection');

/**
 * Collect each already-dependency-filtered prompt exactly once, in array order.
 *
 * @param {import('vscode')} vscode
 * @param {object[]} prompts
 * @param {Record<string, string>} builtInContext
 * @param {{targetDirectory: string, targetUri: import('vscode').Uri, workspaceDirectories: string[]}} pathContext
 * @param {Record<string, object[]>} [collections]
 * @param {Record<string, any>} [rawValues]
 * @returns {Promise<Record<string, any> | undefined>}
 */
async function collectPromptValues(vscode, prompts, builtInContext, pathContext, collections = {}, rawValues = {}) {
  const values = {};
  for (const definition of prompts) {
    let value;
    if (definition.type === 'selectFromCollection') {
      value = await promptSelectFromCollection(vscode, definition, collections[definition.collection] || []);
      pathContext.log?.(`Prompt ${definition.key}: ${Array.isArray(value) ? value.length : value ? 1 : 0} record(s) selected.`);
    } else if (definition.type === 'input') {
      value = await promptInput(vscode, definition, builtInContext, pathContext);
    } else if (definition.type === 'pick') {
      value = await promptPick(vscode, definition, pathContext);
    } else if (definition.type === 'multiPick') {
      value = await promptMultiPick(vscode, definition);
    } else if (definition.type === 'confirm') {
      const result = await promptConfirmResult(vscode, definition);
      value = result?.value;
      if (result) rawValues[definition.key] = result.rawValue;
    } else {
      value = await promptPath(vscode, definition, pathContext);
    }
    if (value === undefined) {
      return undefined;
    }
    values[definition.key] = value;
    if (definition.type !== 'confirm') rawValues[definition.key] = value;
  }
  return values;
}

module.exports = { collectPromptValues };
