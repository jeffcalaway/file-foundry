'use strict';

const { resolveOptionalPath } = require('../utils/resolveOptionalPath');
const { log } = require('../utils/outputChannel');
const { workspaceDirectories } = require('./uiHelpers');

/**
 * @param {import('vscode')} vscode
 * @param {import('vscode').OutputChannel} outputChannel
 * @param {import('../extractors/extractorService').ExtractorService} extractorService
 * @param {boolean} [force]
 */
async function loadConfiguredExtractors(vscode, outputChannel, extractorService, force = false) {
  const directories = workspaceDirectories(vscode);
  const configuration = vscode.workspace.getConfiguration('fileFoundry');
  return extractorService.ensureLoaded({
    presetsFile: resolveOptionalPath(configuration.get('extractorsFile', ''), directories),
    customDirectory: resolveOptionalPath(configuration.get('customExtractorsDirectory', ''), directories),
    trusted: vscode.workspace.isTrusted,
    force,
    log: (message) => log(outputChannel, message)
  });
}

module.exports = { loadConfiguredExtractors };
