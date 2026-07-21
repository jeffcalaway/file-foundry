'use strict';

const { renderRecordTemplate } = require('../templates/renderRecordTemplate');

/** @param {import('vscode')} vscode @param {object} definition @param {object[]} records */
async function promptSelectFromCollection(vscode, definition, records) {
  if (records.length === 0) {
    if (definition.selection.required) throw new Error(`Required collection prompt ${JSON.stringify(definition.key)} has an empty collection.`);
    return definition.selection.mode === 'multi' ? [] : null;
  }
  const items = records.map((record, sourceIndex) => {
    const label = renderRecordTemplate(definition.option.label, record);
    if (!label.trim()) throw new Error(`Collection prompt ${JSON.stringify(definition.key)} rendered an empty option label.`);
    return {
      label,
      description: definition.option.description ? renderRecordTemplate(definition.option.description, record) : undefined,
      detail: definition.option.detail ? renderRecordTemplate(definition.option.detail, record) : undefined,
      picked: definition.selection.mode === 'multi' && definition.selection.defaultSelected === 'all',
      record,
      sourceIndex
    };
  });

  if (definition.selection.mode === 'single') {
    const presented = definition.selection.defaultSelected === 'first' ? items : items;
    const selected = await vscode.window.showQuickPick(presented, {
      title: definition.title, placeHolder: definition.prompt, canPickMany: false, ignoreFocusOut: true
    });
    return selected === undefined ? undefined : selected.record;
  }
  while (true) {
    const selected = await vscode.window.showQuickPick(items, {
      title: definition.title, placeHolder: definition.prompt, canPickMany: true, ignoreFocusOut: true
    });
    if (selected === undefined) return undefined;
    if (!definition.selection.required || selected.length > 0) {
      const ordered = [...selected];
      if (definition.selection.order === 'label') ordered.sort((a, b) => a.label.localeCompare(b.label));
      else ordered.sort((a, b) => a.sourceIndex - b.sourceIndex);
      return ordered.map((item) => item.record);
    }
    await vscode.window.showWarningMessage(`${definition.title || definition.key} requires at least one selection.`);
  }
}

module.exports = { promptSelectFromCollection };
