'use strict';

/** @param {import('vscode')} vscode @param {object} definition */
async function promptConfirm(vscode, definition) {
  const result = await promptConfirmResult(vscode, definition);
  return result?.value;
}

/** @param {import('vscode')} vscode @param {object} definition */
async function promptConfirmResult(vscode, definition) {
  const items = [
    {
      label: definition.trueLabel,
      value: definition.trueValue,
      rawValue: true,
      picked: definition.default === true
    },
    {
      label: definition.falseLabel,
      value: definition.falseValue,
      rawValue: false,
      picked: definition.default === false
    }
  ];
  const presentedItems = definition.default === false ? [items[1], items[0]] : items;
  const selected = await vscode.window.showQuickPick(presentedItems, {
    title: definition.title,
    placeHolder: definition.prompt,
    canPickMany: false,
    ignoreFocusOut: true
  });
  return selected ? { value: selected.value, rawValue: selected.rawValue } : undefined;
}

module.exports = { promptConfirm, promptConfirmResult };
