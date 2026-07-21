'use strict';

const vscode = require('vscode');
const { BlueprintUsageStore } = require('./blueprints/blueprintUsageStore');
const { createClearMostSelectedBlueprintsCommand } = require('./commands/clearMostSelectedBlueprints');
const { createConfigureBlueprintDirectoryCommand } = require('./commands/configureBlueprintDirectory');
const { createForgeBlueprintHereCommand } = require('./commands/forgeBlueprintHere');
const { createListRegisteredExtractorsCommand } = require('./commands/listRegisteredExtractors');
const { createOpenBlueprintDirectoryCommand } = require('./commands/openBlueprintDirectory');
const { createOpenCustomExtractorsDirectoryCommand } = require('./commands/openCustomExtractorsDirectory');
const { createReloadCustomExtractorsCommand } = require('./commands/reloadCustomExtractors');
const { ExtractorService } = require('./extractors/extractorService');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const outputChannel = vscode.window.createOutputChannel('File Foundry');
  const extractorService = new ExtractorService();
  const blueprintUsageStore = new BlueprintUsageStore(context.workspaceState);

  context.subscriptions.push(
    outputChannel,
    vscode.commands.registerCommand(
      'fileFoundry.forgeBlueprintHere',
      createForgeBlueprintHereCommand(vscode, outputChannel, extractorService, blueprintUsageStore)
    ),
    vscode.commands.registerCommand(
      'fileFoundry.clearMostSelectedBlueprints',
      createClearMostSelectedBlueprintsCommand(vscode, blueprintUsageStore)
    ),
    vscode.commands.registerCommand(
      'fileFoundry.configureBlueprintDirectory',
      createConfigureBlueprintDirectoryCommand(vscode, outputChannel)
    ),
    vscode.commands.registerCommand(
      'fileFoundry.openBlueprintDirectory',
      createOpenBlueprintDirectoryCommand(vscode, outputChannel)
    ),
    vscode.commands.registerCommand(
      'fileFoundry.openCustomExtractorsDirectory',
      createOpenCustomExtractorsDirectoryCommand(vscode, outputChannel)
    ),
    vscode.commands.registerCommand(
      'fileFoundry.reloadCustomExtractors',
      createReloadCustomExtractorsCommand(vscode, outputChannel, extractorService)
    ),
    vscode.commands.registerCommand(
      'fileFoundry.listRegisteredExtractors',
      createListRegisteredExtractorsCommand(vscode, outputChannel, extractorService)
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
