'use strict';

const path = require('path');

/**
 * @param {import('vscode')} vscode
 * @param {import('vscode').OutputChannel} outputChannel
 */
function createConfigureBlueprintDirectoryCommand(vscode, outputChannel) {
  return async function configureBlueprintDirectory() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const selections = await vscode.window.showOpenDialog({
      title: 'Select the File Foundry blueprint directory',
      defaultUri: workspaceFolder?.uri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use as Blueprint Directory'
    });

    if (!selections?.[0]) {
      return;
    }
    if (selections[0].scheme !== 'file') {
      await vscode.window.showErrorMessage('File Foundry requires a local file-system blueprint directory.');
      return;
    }

    const scopeItems = [
      {
        label: 'User Settings',
        description: 'Use this blueprint directory in all workspaces',
        target: vscode.ConfigurationTarget.Global
      }
    ];
    if (workspaceFolder) {
      scopeItems.unshift({
        label: 'Workspace Settings',
        description: 'Use this blueprint directory only in the current workspace',
        target: vscode.ConfigurationTarget.Workspace
      });
    }

    const scope = await vscode.window.showQuickPick(scopeItems, {
      title: 'Save the blueprint directory to…',
      placeHolder: 'Choose a settings scope'
    });
    if (!scope) {
      return;
    }

    const selectedPath = path.normalize(selections[0].fsPath);
    await vscode.workspace
      .getConfiguration('fileFoundry')
      .update('blueprintsDirectory', selectedPath, scope.target);

    outputChannel.appendLine(`[${new Date().toISOString()}] Configured blueprint directory: ${selectedPath}`);
    await vscode.window.showInformationMessage(
      `File Foundry blueprint directory saved to ${scope.label}: ${selectedPath}`
    );
  };
}

module.exports = { createConfigureBlueprintDirectoryCommand };
