'use strict';

/**
 * @param {import('vscode')} vscode
 * @param {{enabled: boolean, title: string, placeholder: string, options: Array<object>}} fileSelection
 * @returns {Promise<string[] | undefined>}
 */
async function collectOutputSelection(vscode, fileSelection, options = {}) {
  if (!fileSelection.enabled) {
    return fileSelection.options.filter((option) => option.required).map((option) => option.key);
  }

  const items = fileSelection.options.map((option) => ({
    label: option.label,
    description: option.required
      ? [option.description, 'Required'].filter(Boolean).join(' — ')
      : option.description,
    detail: option.detail,
    picked: options.suppressPreselection ? false : option.required || option.defaultSelected,
    option
  }));

  while (true) {
    const selected = await vscode.window.showQuickPick(items, {
      title: fileSelection.title,
      placeHolder: fileSelection.placeholder,
      canPickMany: true
    });
    if (selected === undefined) {
      return undefined;
    }
    const selectedKeys = new Set(selected.map((item) => item.option.key));
    const missingRequired = fileSelection.options.filter((option) => option.required && !selectedKeys.has(option.key));
    if (missingRequired.length === 0) {
      return [...selectedKeys];
    }
    await vscode.window.showWarningMessage(
      `Required output${missingRequired.length === 1 ? '' : 's'} must remain selected: ${missingRequired.map((option) => option.label).join(', ')}.`
    );
    for (const item of items) {
      item.picked = item.option.required || selectedKeys.has(item.option.key);
    }
  }
}

module.exports = { collectOutputSelection };
