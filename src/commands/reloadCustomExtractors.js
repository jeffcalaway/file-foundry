'use strict';

const { errorMessage, log, technicalError } = require('../utils/outputChannel');
const { loadConfiguredExtractors } = require('./extractorCommandHelpers');

/**
 * @param {import('vscode')} vscode
 * @param {import('vscode').OutputChannel} outputChannel
 * @param {import('../extractors/extractorService').ExtractorService} extractorService
 */
function createReloadCustomExtractorsCommand(vscode, outputChannel, extractorService) {
  return async function reloadCustomExtractors() {
    try {
      const registry = await loadConfiguredExtractors(vscode, outputChannel, extractorService, true);
      const customCount = registry.list().filter((extractor) => extractor.sourceType === 'Custom module').length;
      log(outputChannel, `Reloaded extractors; ${customCount} custom module(s) registered.`);
      await vscode.window.showInformationMessage(
        `File Foundry reloaded extractors. ${customCount} custom module${customCount === 1 ? '' : 's'} registered.`
      );
    } catch (error) {
      log(outputChannel, `Extractor reload failed: ${technicalError(error)}`);
      await vscode.window.showErrorMessage(`File Foundry could not reload extractors: ${errorMessage(error)}`);
    }
  };
}

module.exports = { createReloadCustomExtractorsCommand };
