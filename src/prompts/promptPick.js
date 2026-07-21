'use strict';

const path = require('path');

/** @param {import('vscode')} vscode @param {object} definition */
async function promptPick(vscode, definition, context = {}) {
  const items = definition.options.map((option) => ({
    label: option.label,
    description: option.description,
    detail: option.detail,
    picked: option.value === definition.default,
    iconPath: resolveOptionIconPath(vscode, option.iconPath, context.blueprintDirectory),
    value: option.value
  }));
  const presentedItems = moveDefaultFirst(items, definition.default);
  const selected = await vscode.window.showQuickPick(presentedItems, {
    title: definition.title,
    placeHolder: definition.prompt,
    canPickMany: false,
    ignoreFocusOut: true
  });
  return selected?.value;
}

/** Resolve manifest-relative Quick Pick icons without allowing blueprint traversal. */
function resolveOptionIconPath(vscode, iconPath, blueprintDirectory) {
  if (iconPath === undefined) return undefined;
  if (!blueprintDirectory) throw new Error('Pick option icons require a blueprint directory context.');
  const resolveOne = (relativePath) => {
    const absolute = path.resolve(blueprintDirectory, relativePath);
    const relative = path.relative(path.resolve(blueprintDirectory), absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Pick option icon escapes the blueprint directory: ${relativePath}.`);
    }
    return vscode.Uri.file(absolute);
  };
  return typeof iconPath === 'string'
    ? resolveOne(iconPath)
    : { light: resolveOne(iconPath.light), dark: resolveOne(iconPath.dark) };
}

/** @param {object[]} items @param {string | undefined} defaultValue */
function moveDefaultFirst(items, defaultValue) {
  if (defaultValue === undefined) {
    return items;
  }
  const index = items.findIndex((item) => item.value === defaultValue);
  return index > 0 ? [items[index], ...items.slice(0, index), ...items.slice(index + 1)] : items;
}

module.exports = { moveDefaultFirst, promptPick, resolveOptionIconPath };
