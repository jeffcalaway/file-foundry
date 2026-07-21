'use strict';

const assert = require('assert').strict;
const { test } = require('./harness');
const {
  BlueprintUsageStore,
  MAX_STORED_BLUEPRINTS,
  STORAGE_KEY
} = require('../src/blueprints/blueprintUsageStore');
const { createClearMostSelectedBlueprintsCommand } = require('../src/commands/clearMostSelectedBlueprints');
const { buildBlueprintPickerItems } = require('../src/commands/forgeBlueprintHere');

class MemoryMemento {
  constructor() { this.values = new Map(); this.updates = 0; }
  get(key) { return this.values.get(key); }
  async update(key, value) {
    this.updates += 1;
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
}

function blueprint(name) {
  return { name, directoryName: name, directory: `/blueprints/${name}`, warnings: [] };
}

test('Most Selected evicts the oldest tie and promotes a newly higher count', async () => {
  const memento = new MemoryMemento();
  const store = new BlueprintUsageStore(memento);
  const blueprints = ['Alpha', 'Beta', 'Charlie', 'Delta'].map(blueprint);
  for (const name of ['Alpha', 'Alpha', 'Beta', 'Beta', 'Charlie', 'Charlie']) {
    await store.recordSelection(name);
  }
  assert.deepEqual(store.getMostSelected(blueprints).map((item) => item.blueprint.name), [
    'Alpha', 'Beta', 'Charlie'
  ]);

  await store.recordSelection('Delta');
  await store.recordSelection('Delta');
  assert.deepEqual(store.getMostSelected(blueprints).map((item) => item.blueprint.name), [
    'Beta', 'Charlie', 'Delta'
  ]);

  await store.recordSelection('Alpha');
  assert.deepEqual(store.getMostSelected(blueprints).map((item) => item.blueprint.name), [
    'Alpha', 'Charlie', 'Delta'
  ]);
  assert.equal(memento.updates, 9, 'history should perform exactly one workspace-state write per selection');
});

test('Most Selected storage stays bounded and ignores malformed persisted records', async () => {
  const memento = new MemoryMemento();
  memento.values.set(STORAGE_KEY, {
    version: 1,
    sequence: 'invalid',
    records: { Broken: { count: -1, lastSelected: 'never' } }
  });
  const store = new BlueprintUsageStore(memento);
  assert.deepEqual(store.getMostSelected([blueprint('Broken')]), []);
  for (let index = 0; index < MAX_STORED_BLUEPRINTS + 25; index += 1) {
    await store.recordSelection(`Blueprint ${index}`);
  }
  const persisted = memento.get(STORAGE_KEY);
  assert.equal(Object.keys(persisted.records).length, MAX_STORED_BLUEPRINTS);
  assert(JSON.stringify(persisted).length < 12000, 'workspace history should remain a small bounded payload');
});

test('blueprint picker creates starred sections without duplicate options', () => {
  const blueprints = ['Alpha', 'Beta', 'Charlie', 'Delta'].map(blueprint);
  const mostSelected = [
    { blueprint: blueprints[1], count: 3, lastSelected: 4 },
    { blueprint: blueprints[2], count: 2, lastSelected: 5 }
  ];
  const items = buildBlueprintPickerItems(
    { QuickPickItemKind: { Separator: -1 } },
    blueprints,
    mostSelected
  );
  assert.deepEqual(items.map((item) => item.label), [
    'Most Selected', '$(star-full) Beta', '$(star-full) Charlie',
    'All Blueprints', 'Alpha', 'Delta'
  ]);
  assert.equal(items.filter((item) => item.blueprint).length, blueprints.length);
});

test('clear command deletes only workspace Most Selected history', async () => {
  const memento = new MemoryMemento();
  const store = new BlueprintUsageStore(memento);
  await store.recordSelection('Alpha');
  const messages = [];
  const command = createClearMostSelectedBlueprintsCommand({
    window: { showInformationMessage: async (message) => messages.push(message) }
  }, store);
  await command();
  assert.equal(memento.get(STORAGE_KEY), undefined);
  assert.match(messages[0], /cleared Most Selected history for 1 blueprint/u);
});

test('Most Selected setting and clear command are contributed for global or workspace use', () => {
  const packageJson = require('../package.json');
  const setting = packageJson.contributes.configuration.properties['fileFoundry.mostSelectedBlueprints'];
  assert.deepEqual({ type: setting.type, default: setting.default, scope: setting.scope }, {
    type: 'boolean', default: true, scope: 'resource'
  });
  assert(packageJson.activationEvents.includes('onCommand:fileFoundry.clearMostSelectedBlueprints'));
  assert(packageJson.contributes.commands.some((command) =>
    command.command === 'fileFoundry.clearMostSelectedBlueprints'
  ));
  assert(packageJson.contributes.menus.commandPalette.some((item) =>
    item.command === 'fileFoundry.clearMostSelectedBlueprints'
  ));
});
