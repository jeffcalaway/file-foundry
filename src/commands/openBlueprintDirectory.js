'use strict';

const { resolveBlueprintDirectory } = require('../blueprints/resolveBlueprintDirectory');
const { errorMessage, log, technicalError } = require('../utils/outputChannel');
const { showBlueprintDirectoryError, workspaceDirectories } = require('./uiHelpers');

/**
 * @param {import('vscode')} vscode
 * @param {import('vscode').OutputChannel} outputChannel
 */
function createOpenBlueprintDirectoryCommand(vscode, outputChannel) {
  return async function openBlueprintDirectory() {
    try {
      const configuredPath = vscode.workspace
        .getConfiguration('fileFoundry')
        .get('blueprintsDirectory', '');
      const resolved = await resolveBlueprintDirectory(configuredPath, {
        workspaceDirectories: workspaceDirectories(vscode)
      });

      log(outputChannel, `Resolved blueprint directory: ${resolved}`);
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(resolved));
    } catch (error) {
      log(outputChannel, `Unable to open blueprint directory: ${technicalError(error)}`);
      await showBlueprintDirectoryError(vscode, errorMessage(error));
    }
  };
}

module.exports = { createOpenBlueprintDirectoryCommand };
