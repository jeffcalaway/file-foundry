'use strict';

const assert = require('assert').strict;
const Module = require('module');
const path = require('path');

const registered = [];
const vscode = {
  window: {
    createOutputChannel: () => ({ dispose() {} })
  },
  commands: {
    registerCommand: (command, callback) => {
      registered.push({ command, callback });
      return { dispose() {} };
    }
  }
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const bundlePath = path.resolve(__dirname, '../dist/extension.js');
  delete require.cache[bundlePath];
  const extension = require(bundlePath);
  const context = {
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => undefined }
  };
  extension.activate(context);
  assert.deepEqual(registered.map((entry) => entry.command).sort(), [
    'fileFoundry.clearMostSelectedBlueprints',
    'fileFoundry.configureBlueprintDirectory',
    'fileFoundry.forgeBlueprintHere',
    'fileFoundry.listRegisteredExtractors',
    'fileFoundry.openBlueprintDirectory',
    'fileFoundry.openCustomExtractorsDirectory',
    'fileFoundry.reloadCustomExtractors'
  ]);
  assert.equal(context.subscriptions.length, registered.length + 1);
  process.stdout.write(`Verified bundled activation and ${registered.length} registered commands.\n`);
} finally {
  Module._load = originalLoad;
}
