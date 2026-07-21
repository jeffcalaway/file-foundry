'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildForgePlan } = require('../src/forge/buildForgePlan');
const { inspectSelectedSources } = require('../src/forge/inspectSelectedSources');
const { normalizeBlueprintManifest } = require('../src/manifests/normalizeBlueprintManifest');
const { replacePlaceholders } = require('../src/placeholders/replacePlaceholders');
const { createPromptDependencies } = require('../src/prompts/createPromptDependencies');
const { parseTemplate } = require('../src/templates/parseTemplate');
const { renderRecordTemplate } = require('../src/templates/renderRecordTemplate');
const { renderTemplate } = require('../src/templates/renderTemplate');
const { test } = require('./harness');

const fsp = fs.promises;

test('collection loops render aliases, transforms, metadata, and preserve line endings', () => {
  const source = 'head\r\n[[#each Collection:Files as File]][[File:@number]]/[[File:@count]] [[File:stem>PascalCase]] [[File:@first]] [[File:@last]]\r\n[[/each]]tail';
  const parsed = parseTemplate(source, 'index.js');
  const output = renderTemplate(parsed, { collections: { Files: [
    { stem: 'menu-link' }, { stem: 'card' }
  ] }, prompts: {} });
  assert.strictEqual(output, 'head\r\n1/2 MenuLink true false\r\n2/2 Card false true\r\ntail');
  assert.deepStrictEqual(parsed.collectionKeys, ['Files']);
});

test('standalone loop lines do not introduce blank lines between rendered records', () => {
  const source = [
    'export const Default: Story = {',
    '  args: {',
    '[[#each Prompt:SelectedProps as Prop]]',
    '    [[Prop:name]]: [[#if Prop:hasDefault]][[Prop:defaultValue]][[#else]]undefined[[/if]][[#if not Prop:@last]],[[/if]]',
    '[[/each]]',
    '  }',
    '};'
  ].join('\n');
  const parsed = parseTemplate(source, 'story.ts');
  const output = renderTemplate(parsed, {
    collections: {},
    prompts: { SelectedProps: [
      { name: 'as', hasDefault: true, defaultValue: "'article'" },
      { name: 'children', hasDefault: true, defaultValue: "'Test Component'" },
      { name: 'className', hasDefault: true, defaultValue: "''" }
    ] }
  });

  assert.strictEqual(output, [
    'export const Default: Story = {',
    '  args: {',
    "    as: 'article',",
    "    children: 'Test Component',",
    "    className: ''",
    '  }',
    '};'
  ].join('\n'));
});

test('multi-select prompt loops and nested loops use isolated alias scopes', () => {
  const parsed = parseTemplate(
    '[[#each Collection:Groups as Group]][[Group:name]]:[[#each Prompt:Items as Item]][[Item:name]];[[/each]][[/each]]',
    'nested.txt'
  );
  const output = renderTemplate(parsed, {
    collections: { Groups: [{ name: 'A' }, { name: 'B' }] },
    prompts: { Items: [{ name: 'x' }, { name: 'y' }] }
  });
  assert.strictEqual(output, 'A:x;y;B:x;y;');
  assert.deepStrictEqual(parsed.promptKeys, ['Items']);
});

test('empty loop collections render no content', () => {
  const parsed = parseTemplate('before[[#each Collection:Files as File]][[File:name]][[/each]]after', 'empty.txt');
  assert.strictEqual(renderTemplate(parsed, { collections: { Files: [] }, prompts: {} }), 'beforeafter');
});

test('loop parser rejects malformed blocks, collisions, unknown metadata, and escaped aliases', () => {
  assert.throws(() => parseTemplate('[[/each]]', 'x'), /Unexpected/);
  assert.throws(() => parseTemplate('[[#each Collection:Files File]]', 'x'), /Malformed/);
  assert.throws(() => parseTemplate('[[#each Collection:Files as File]]', 'x'), /Missing/);
  assert.throws(() => parseTemplate('[[#each Collection:Files as 1File]][[/each]]', 'x'), /Malformed/);
  assert.throws(() => parseTemplate('[[File:name]]', 'x'), /outside/);
  assert.throws(() => parseTemplate('[[#each Collection:A as Item]][[#each Collection:B as Item]][[/each]][[/each]]', 'x'), /reuses/);
  assert.throws(() => parseTemplate('[[#each Collection:A as Item]][[Item:@middle]][[/each]]', 'x'), /Unknown loop metadata/);
  assert.throws(() => parseTemplate('[[#each Collection:A as Item]][[Item:@index>UpperCase]][[/each]]', 'x'), /metadata cannot/);
});

test('loop rendering rejects missing fields and non-collection sources', () => {
  const missing = parseTemplate('[[#each Collection:Files as File]][[File:nope]][[/each]]', 'x');
  assert.throws(() => renderTemplate(missing, { collections: { Files: [{}] }, prompts: {} }), /no field/);
  const scalar = parseTemplate('[[#each Prompt:Value as Item]][[Item:name]][[/each]]', 'x');
  assert.throws(() => renderTemplate(scalar, { collections: {}, prompts: { Value: 'x' } }), /not a collection/);
});

test('record option templates render static text and reject missing fields', () => {
  assert.strictEqual(renderRecordTemplate('File: [[Item:name>TitleCase]] ([[Item:depth]])', { name: 'menu-link', depth: 2 }), 'File: Menu Link (2)');
  assert.throws(() => renderRecordTemplate('[[Item:missing]]', { name: 'x' }), /no field/);
});

test('single-record prompt placeholders render scalar fields and transformations', () => {
  assert.strictEqual(replacePlaceholders(
    '[[Prompt:Primary.name]] -> [[Prompt:Primary.stem>PascalCase]] [[Prompt:Primary.empty]]',
    { Prompt: { Primary: { name: 'menu-link.js', stem: 'menu-link', empty: null } } }
  ), 'menu-link.js -> MenuLink ');
  assert.throws(() => replacePlaceholders('[[Prompt:Primary.missing]]', { Prompt: { Primary: { name: 'x' } } }), /No value/);
});

test('dependency analysis requests only selected template collections and their prompts', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-dependencies-'));
  try {
    const selected = path.join(root, 'selected.txt');
    const unselected = path.join(root, 'unselected.txt');
    await fsp.writeFile(selected, '[[#each Prompt:Chosen as Item]][[Item:name]][[/each]]');
    await fsp.writeFile(unselected, '[[#each Collection:Unused as Item]][[Item:name]][[/each]]');
    const inspected = await inspectSelectedSources([{ type: 'file', sourcePath: selected, relativePath: 'selected.txt' }]);
    const manifest = normalizeBlueprintManifest({
      version: 1,
      collections: {
        Used: { type: 'filesystem', source: { scope: 'target', path: '.' } },
        Unused: { type: 'filesystem', source: { scope: 'target', path: '.' } }
      },
      prompts: [{ key: 'Chosen', type: 'selectFromCollection', collection: 'Used' }]
    }, 'Test');
    const dependencies = createPromptDependencies(inspected, manifest);
    assert.deepStrictEqual(dependencies.collectionKeys, ['Used']);
    assert.deepStrictEqual(dependencies.prompts.map((prompt) => prompt.key), ['Chosen']);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('dependency analysis rejects invalid scalar and loop prompt usage', () => {
  const base = normalizeBlueprintManifest({
    version: 1,
    collections: { Files: { type: 'filesystem', source: { scope: 'target', path: '.' } } },
    prompts: [
      { key: 'Text', type: 'input' },
      { key: 'Many', type: 'selectFromCollection', collection: 'Files', selection: { mode: 'multi' } },
      { key: 'One', type: 'selectFromCollection', collection: 'Files', selection: { mode: 'single' } }
    ]
  }, 'Test');
  assert.throws(() => createPromptDependencies([{ relativePath: 'x', placeholderMatches: [{ parsed: { namespace: 'Prompt', key: 'Text', field: 'name' } }] }], base), /Scalar prompt/);
  assert.throws(() => createPromptDependencies([{ relativePath: 'x', placeholderMatches: [{ parsed: { namespace: 'Prompt', key: 'Many', field: 'name' } }] }], base), /Multi-select/);
  assert.throws(() => createPromptDependencies([{ relativePath: 'x', placeholderMatches: [{ parsed: { namespace: 'Prompt', key: 'One' } }] }], base), /record field/);
  assert.throws(() => createPromptDependencies([{ relativePath: 'x', placeholderMatches: [], template: { promptKeys: ['Text'] } }], base), /cannot be looped/);
});

test('forge planning renders loops before ordinary placeholders and writes nothing during validation', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-loop-forge-'));
  try {
    const blueprint = path.join(root, 'blueprint');
    const target = path.join(root, 'target');
    await Promise.all([fsp.mkdir(blueprint), fsp.mkdir(target)]);
    const source = path.join(blueprint, 'index-[[FolderName>KebabCase]].js');
    await fsp.writeFile(source, '[[#each Collection:Files as File]]export [[File:stem>PascalCase]] from "./[[File:relativePath]]";\n[[/each]]// [[FolderName]]');
    const entries = await inspectSelectedSources([{ type: 'file', sourcePath: source, relativePath: path.basename(source) }]);
    const plan = await buildForgePlan({
      blueprintDirectory: blueprint, targetDirectory: target, sourceEntries: entries,
      context: { FolderName: 'target', Collection: { Files: [{ stem: 'menu-link', relativePath: 'menu-link.js' }] }, Prompt: {}, Custom: {} }
    });
    assert.strictEqual(plan.files[0].destinationRelativePath, 'index-target.js');
    assert.strictEqual(plan.files[0].contents.toString(), 'export MenuLink from "./menu-link.js";\n// target');
    assert.deepStrictEqual(await fsp.readdir(target), []);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('loop directives in binary blueprint contents are rejected', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-binary-loop-'));
  try {
    const source = path.join(root, 'binary.dat');
    await fsp.writeFile(source, Buffer.concat([Buffer.from([0]), Buffer.from('[[#each Collection:Files as File]]')]));
    await assert.rejects(inspectSelectedSources([{
      type: 'file', sourcePath: source, relativePath: 'binary.dat'
    }]), /unsupported in binary content/);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});
