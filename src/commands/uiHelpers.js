'use strict';

const OPEN_SETTINGS_ACTION = 'Open File Foundry Settings';

/**
 * @param {import('vscode')} vscode
 * @param {string} message
 */
async function showBlueprintDirectoryError(vscode, message) {
  const action = await vscode.window.showErrorMessage(message, OPEN_SETTINGS_ACTION);
  if (action === OPEN_SETTINGS_ACTION) {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'fileFoundry.blueprintsDirectory'
    );
  }
}

/** @param {import('vscode')} vscode */
function workspaceDirectories(vscode) {
  return (vscode.workspace.workspaceFolders || [])
    .filter((folder) => folder.uri.scheme === 'file')
    .map((folder) => folder.uri.fsPath);
}

module.exports = { OPEN_SETTINGS_ACTION, showBlueprintDirectoryError, workspaceDirectories };
