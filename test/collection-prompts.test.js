'use strict';

const assert = require('assert').strict;
const { collectPromptValues } = require('../src/prompts/collectPromptValues');
const { promptSelectFromCollection } = require('../src/prompts/promptSelectFromCollection');
const { test } = require('./harness');

function prompt(overrides = {}) {
  return {
    key: 'Selected', type: 'selectFromCollection', title: 'Choose records', prompt: 'Choose',
    selection: { mode: 'multi', defaultSelected: 'none', required: false, order: 'source' },
    option: { label: '[[Item:name]]', description: '[[Item:relativePath]]', detail: 'Depth [[Item:depth]]' },
    ...overrides
  };
}

const records = [
  { name: 'zeta', relativePath: 'zeta', depth: 0 },
  { name: 'Alpha', relativePath: 'nested/alpha', depth: 1 },
  { name: 'same', relativePath: 'a/same', depth: 1 },
  { name: 'same', relativePath: 'b/same', depth: 1 }
];

test('single collection selection returns the original structured record with rendered UI metadata', async () => {
  let presented;
  const vscode = { window: { showQuickPick: async (items, options) => {
    presented = { items, options };
    return items[1];
  } } };
  const result = await promptSelectFromCollection(vscode, prompt({
    selection: { mode: 'single', defaultSelected: 'first', required: true, order: 'source' }
  }), records);
  assert.strictEqual(result, records[1]);
  assert.equal(presented.options.canPickMany, false);
  assert.equal(presented.items[1].description, 'nested/alpha');
  assert.equal(presented.items[1].detail, 'Depth 1');
});

test('multi collection selection supports default all and source ordering', async () => {
  let presented;
  const vscode = { window: {
    showQuickPick: async (items) => { presented = items; return [items[3], items[0]]; },
    showWarningMessage: async () => undefined
  } };
  const result = await promptSelectFromCollection(vscode, prompt({
    selection: { mode: 'multi', defaultSelected: 'all', required: false, order: 'source' }
  }), records);
  assert(presented.every((item) => item.picked));
  assert.deepEqual(result, [records[0], records[3]]);
});

test('multi collection selection supports label ordering and duplicate labels', async () => {
  const vscode = { window: {
    showQuickPick: async (items) => items,
    showWarningMessage: async () => undefined
  } };
  const result = await promptSelectFromCollection(vscode, prompt({
    selection: { mode: 'multi', defaultSelected: 'none', required: false, order: 'label' }
  }), records);
  assert.deepEqual(result.map((record) => record.name), ['Alpha', 'same', 'same', 'zeta']);
  assert.notStrictEqual(result[1], result[2]);
});

test('selection order falls back to source order and cancellation cancels forging', async () => {
  const sourceFallback = { window: {
    showQuickPick: async (items) => [items[2], items[0]],
    showWarningMessage: async () => undefined
  } };
  assert.deepEqual(await promptSelectFromCollection(sourceFallback, prompt({
    selection: { mode: 'multi', defaultSelected: 'none', required: false, order: 'selection' }
  }), records), [records[0], records[2]]);
  const canceled = { window: { showQuickPick: async () => undefined } };
  assert.equal(await promptSelectFromCollection(canceled, prompt(), records), undefined);
});

test('required multi selection repeats until populated', async () => {
  let calls = 0;
  const vscode = { window: {
    showQuickPick: async (items) => (++calls === 1 ? [] : [items[0]]),
    showWarningMessage: async () => undefined
  } };
  assert.deepEqual(await promptSelectFromCollection(vscode, prompt({
    selection: { mode: 'multi', defaultSelected: 'none', required: true, order: 'source' }
  }), records), [records[0]]);
  assert.equal(calls, 2);
});

test('empty collections continue for optional prompts and abort required prompts', async () => {
  const vscode = { window: {} };
  assert.deepEqual(await promptSelectFromCollection(vscode, prompt(), []), []);
  assert.equal(await promptSelectFromCollection(vscode, prompt({
    selection: { mode: 'single', defaultSelected: 'none', required: false, order: 'source' }
  }), []), null);
  await assert.rejects(promptSelectFromCollection(vscode, prompt({
    selection: { mode: 'multi', defaultSelected: 'none', required: true, order: 'source' }
  }), []), /empty collection/);
});

test('collection prompt option templates reject absent fields and empty labels', async () => {
  const vscode = { window: { showQuickPick: async (items) => items } };
  await assert.rejects(promptSelectFromCollection(vscode, prompt({ option: { label: '[[Item:nope]]' } }), records), /no field/);
  await assert.rejects(promptSelectFromCollection(vscode, prompt({ option: { label: '  ' } }), records), /empty option label/);
});

test('prompt collection reuses collection records for multiple selection prompts', async () => {
  let calls = 0;
  const vscode = { window: { showQuickPick: async (items, options) => {
    calls += 1;
    return options.canPickMany ? [items[0]] : items[1];
  } } };
  const definitions = [
    prompt({ key: 'Primary', collection: 'Files', selection: { mode: 'single', defaultSelected: 'none', required: true, order: 'source' } }),
    prompt({ key: 'Many', collection: 'Files' })
  ];
  const result = await collectPromptValues(vscode, definitions, {}, { log() {} }, { Files: records });
  assert.strictEqual(result.Primary, records[1]);
  assert.deepEqual(result.Many, [records[0]]);
  assert.equal(calls, 2);
});
