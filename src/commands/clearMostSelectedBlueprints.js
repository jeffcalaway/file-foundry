'use strict';

function createClearMostSelectedBlueprintsCommand(vscode, blueprintUsageStore) {
  return async function clearMostSelectedBlueprints() {
    const count = await blueprintUsageStore.clear();
    await vscode.window.showInformationMessage(count > 0
      ? `File Foundry cleared Most Selected history for ${count} blueprint${count === 1 ? '' : 's'} in this workspace.`
      : 'File Foundry has no Most Selected history in this workspace.');
  };
}

module.exports = { createClearMostSelectedBlueprintsCommand };
