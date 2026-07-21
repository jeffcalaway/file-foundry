'use strict';

/** @param {import('vscode')} vscode @param {object} definition */
async function promptMultiPick(vscode, definition) {
  const defaults = new Set(definition.default || []);
  const items = definition.options.map((option) => ({
    label: option.label,
    description: option.description,
    detail: option.detail,
    picked: defaults.has(option.value),
    value: option.value
  }));

  while (true) {
    const selected = await vscode.window.showQuickPick(items, {
      title: definition.title,
      placeHolder: definition.prompt,
      canPickMany: true,
      ignoreFocusOut: true
    });
    if (selected === undefined) {
      return undefined;
    }
    if (!definition.required || selected.length > 0) {
      return selected.map((item) => item.value).join(definition.separator);
    }
    await vscode.window.showWarningMessage(`${definition.title || definition.key} requires at least one selection.`);
  }
}

module.exports = { promptMultiPick };
