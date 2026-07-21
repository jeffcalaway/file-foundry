'use strict';

const fs = require('fs');
const { resolveOptionalPath } = require('../utils/resolveOptionalPath');
const { errorMessage, log, technicalError } = require('../utils/outputChannel');
const { workspaceDirectories } = require('./uiHelpers');

const fsp = fs.promises;

/**
 * @param {import('vscode')} vscode
 * @param {import('vscode').OutputChannel} outputChannel
 */
function createOpenCustomExtractorsDirectoryCommand(vscode, outputChannel) {
  return async function openCustomExtractorsDirectory() {
    try {
      const configured = vscode.workspace.getConfiguration('fileFoundry').get('customExtractorsDirectory', '');
      if (!configured.trim()) {
        const action = await vscode.window.showInformationMessage(
          'Configure a trusted directory before loading custom File Foundry extractors.',
          'Open Settings'
        );
        if (action === 'Open Settings') {
          await vscode.commands.executeCommand('workbench.action.openSettings', 'fileFoundry.customExtractorsDirectory');
        }
        return;
      }
      const resolved = resolveOptionalPath(configured, workspaceDirectories(vscode));
      const stats = await fsp.stat(resolved);
      if (!stats.isDirectory()) throw new Error(`The configured path is not a directory: ${resolved}.`);
      log(outputChannel, `Resolved custom extractor directory: ${resolved}`);
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(resolved));
    } catch (error) {
      log(outputChannel, `Unable to open custom extractor directory: ${technicalError(error)}`);
      await vscode.window.showErrorMessage(`File Foundry could not open the custom extractor directory: ${errorMessage(error)}`);
    }
  };
}

module.exports = { createOpenCustomExtractorsDirectoryCommand };
