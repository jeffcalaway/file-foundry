'use strict';

const { replacePlaceholders } = require('../placeholders/replacePlaceholders');
const { resolveUsefulGroupPhpNamespace } = require('../integrations/usefulGroupPhpRegistry');

/** @param {import('vscode')} vscode @param {object} definition @param {Record<string, string>} builtInContext */
async function promptInput(vscode, definition, builtInContext, context = {}) {
  if (definition.autoValue?.type === 'usefulGroupPhpNamespace') {
    const resolved = await resolveUsefulGroupPhpNamespace(vscode, context);
    if (resolved !== undefined) return resolved;
  }
  const validationPattern = definition.validation?.pattern
    ? new RegExp(definition.validation.pattern)
    : undefined;
  const defaultValue = definition.default === undefined
    ? undefined
    : replacePlaceholders(
      definition.default,
      builtInContext,
      `blueprint.json prompt ${definition.key} default`
    );

  return vscode.window.showInputBox({
    title: definition.title,
    prompt: definition.prompt,
    placeHolder: definition.placeholder,
    value: defaultValue,
    password: definition.password,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (definition.required && !value.trim()) {
        return `${definition.title || definition.key} is required.`;
      }
      if (validationPattern && !validationPattern.test(value)) {
        return definition.validation.message || `Value must match ${definition.validation.pattern}.`;
      }
      return undefined;
    }
  });
}

module.exports = { promptInput };
