'use strict';

const { errorMessage, log, technicalError } = require('../utils/outputChannel');
const { loadConfiguredExtractors } = require('./extractorCommandHelpers');

/**
 * @param {import('vscode')} vscode
 * @param {import('vscode').OutputChannel} outputChannel
 * @param {import('../extractors/extractorService').ExtractorService} extractorService
 */
function createListRegisteredExtractorsCommand(vscode, outputChannel, extractorService) {
  return async function listRegisteredExtractors() {
    try {
      const registry = await loadConfiguredExtractors(vscode, outputChannel, extractorService);
      await vscode.window.showQuickPick(
        registry.list().map((extractor) => ({
          label: extractor.id,
          description: `${extractor.name} · ${extractor.sourceType}`,
          detail: extractor.sourcePath
        })),
        {
          title: 'File Foundry: Registered Extractors',
          placeHolder: `${registry.list().length} extractor(s) available`,
          matchOnDescription: true,
          matchOnDetail: true
        }
      );
    } catch (error) {
      log(outputChannel, `Unable to list extractors: ${technicalError(error)}`);
      await vscode.window.showErrorMessage(`File Foundry could not list extractors: ${errorMessage(error)}`);
    }
  };
}

module.exports = { createListRegisteredExtractorsCommand };
