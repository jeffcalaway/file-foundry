'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCollectionSource } = require('../src/collections/resolveCollectionSource');
const { resolveCollections } = require('../src/collections/resolveCollections');
const { resolveFilesystemCollection } = require('../src/collections/resolveFilesystemCollection');
const { createFilesystemRecord } = require('../src/collections/resolveFilesystemCollection');
const { ExtractorRegistry } = require('../src/extractors/extractorRegistry');
const { resolveRequiredForgeInputs } = require('../src/forge/resolveRequiredForgeInputs');
const { normalizeBlueprintManifest } = require('../src/manifests/normalizeBlueprintManifest');
const { parseTemplate } = require('../src/templates/parseTemplate');
const { test } = require('./harness');

const fsp = fs.promises;

function definition(overrides = {}) {
  return {
    type: 'filesystem', kind: 'any', recursive: false, includeHidden: false,
    followSymlinks: false, include: [], exclude: [], onEmpty: 'continue',
    sort: { by: 'source', direction: 'ascending', caseSensitive: false, numeric: true },
    ...overrides
  };
}

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-collection-'));
  await fsp.mkdir(path.join(root, 'folder', 'deep'), { recursive: true });
  await fsp.mkdir(path.join(root, '.hidden-folder'));
  await Promise.all([
    fsp.writeFile(path.join(root, 'Button.stories.js'), ''),
    fsp.writeFile(path.join(root, 'item10.js'), ''),
    fsp.writeFile(path.join(root, 'item2.js'), ''),
    fsp.writeFile(path.join(root, 'skip.test.js'), ''),
    fsp.writeFile(path.join(root, '.hidden.js'), ''),
    fsp.writeFile(path.join(root, 'folder', 'nested.jsx'), ''),
    fsp.writeFile(path.join(root, 'folder', 'deep', 'too-deep.js'), ''),
    fsp.writeFile(path.join(root, '.hidden-folder', 'inside.js'), '')
  ]);
  return root;
}

function context(root, overrides = {}) {
  return { trusted: true, blueprintDirectory: path.join(root, 'blueprint'), ...overrides };
}

test('filesystem records expose portable fields and preserve multi-extension stems', () => {
  assert.deepStrictEqual(createFilesystemRecord('stories/examples/Button.stories.js', true), {
    kind: 'file', name: 'Button.stories.js', stem: 'Button.stories', extension: 'js',
    relativePath: 'stories/examples/Button.stories.js', parentName: 'examples',
    parentRelativePath: 'stories/examples', depth: 2, isFile: true, isFolder: false
  });
});

test('filesystem collections support kind, recursion, depth, hidden entries, and filtering', async () => {
  const root = await fixture();
  try {
    const files = await resolveFilesystemCollection(root, definition({
      kind: 'file', recursive: true, maxDepth: 1,
      include: ['**/*.js', '**/*.jsx'], exclude: ['**/*.test.js']
    }), context(root));
    assert.deepStrictEqual(files.map((record) => record.relativePath), [
      'Button.stories.js', 'folder/nested.jsx', 'item10.js', 'item2.js'
    ]);

    const folders = await resolveFilesystemCollection(root, definition({ kind: 'folder' }), context(root));
    assert.deepStrictEqual(folders.map((record) => record.name), ['folder']);

    const hidden = await resolveFilesystemCollection(root, definition({
      kind: 'any', recursive: true, includeHidden: true
    }), context(root));
    assert(hidden.some((record) => record.relativePath === '.hidden.js'));
    assert(hidden.some((record) => record.relativePath === '.hidden-folder/inside.js'));
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('filesystem collection sorting is stable, numeric, and reversible', async () => {
  const root = await fixture();
  try {
    const ascending = await resolveFilesystemCollection(root, definition({
      kind: 'file', sort: { by: 'name', direction: 'ascending', caseSensitive: false, numeric: true }
    }), context(root));
    assert(ascending.findIndex((item) => item.name === 'item2.js') < ascending.findIndex((item) => item.name === 'item10.js'));
    const descending = await resolveFilesystemCollection(root, definition({
      kind: 'file', sort: { by: 'name', direction: 'descending', caseSensitive: false, numeric: true }
    }), context(root));
    assert(descending.findIndex((item) => item.name === 'item10.js') < descending.findIndex((item) => item.name === 'item2.js'));
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('blueprint filesystem collections always omit the root manifest', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-blueprint-collection-'));
  try {
    await fsp.writeFile(path.join(root, 'blueprint.json'), '{}');
    await fsp.writeFile(path.join(root, 'template.txt'), 'x');
    const records = await resolveFilesystemCollection(root, definition({ kind: 'file' }), context(root, { blueprintDirectory: root }));
    assert.deepStrictEqual(records.map((record) => record.name), ['template.txt']);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('collection source scopes resolve safely and reject traversal and absolute paths', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-scopes-'));
  try {
    const workspace = path.join(root, 'workspace');
    const target = path.join(workspace, 'target');
    const blueprint = path.join(root, 'blueprint');
    await Promise.all([fsp.mkdir(target, { recursive: true }), fsp.mkdir(blueprint)]);
    const base = { blueprintDirectory: blueprint, targetDirectory: target, workspaceDirectory: workspace, placeholderContext: {} };
    assert.strictEqual(await resolveCollectionSource({ scope: 'target', path: '.' }, base, 'directory'), target);
    assert.strictEqual(await resolveCollectionSource({ scope: 'targetParent', path: 'target' }, base, 'directory'), target);
    assert.strictEqual(await resolveCollectionSource({ scope: 'workspace', path: 'target' }, base, 'directory'), target);
    assert.strictEqual(await resolveCollectionSource({ scope: 'blueprint', path: '.' }, base, 'directory'), blueprint);
    await assert.rejects(resolveCollectionSource({ scope: 'target', path: '../..' }, base, 'directory'), /escapes/);
    await assert.rejects(resolveCollectionSource({ scope: 'target', path: target }, base, 'directory'), /absolute/);
    await assert.rejects(resolveCollectionSource({ scope: 'workspace', path: '.' }, { ...base, workspaceDirectory: undefined }, 'directory'), /cannot be resolved/);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('filesystem symlinks are skipped by default and safe links are deduplicated when followed', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-links-'));
  try {
    await fsp.mkdir(path.join(root, 'real'));
    await fsp.writeFile(path.join(root, 'real', 'value.js'), '');
    await fsp.symlink(path.join(root, 'real'), path.join(root, 'linked'));
    const messages = [];
    const skipped = await resolveFilesystemCollection(root, definition({ recursive: true, kind: 'file' }), context(root, { log: (message) => messages.push(message) }));
    assert.deepStrictEqual(skipped.map((record) => record.relativePath), ['real/value.js']);
    assert(messages.some((message) => message.includes('Skipped symbolic link')));
    const followed = await resolveFilesystemCollection(root, definition({ recursive: true, kind: 'file', followSymlinks: true }), context(root));
    assert.strictEqual(followed.length, 1);
    await assert.rejects(resolveFilesystemCollection(root, definition({ followSymlinks: true }), context(root, { trusted: false })), /trusted/);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('filesystem symlinks that escape the source root are rejected', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-escape-link-'));
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-outside-link-'));
  try {
    await fsp.writeFile(path.join(outside, 'secret.js'), '');
    await fsp.symlink(outside, path.join(root, 'outside'));
    await assert.rejects(resolveFilesystemCollection(root, definition({ recursive: true, followSymlinks: true }), context(root)), /escapes source root/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  }
});

test('extract collections can read a selected in-memory output before it is written', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-virtual-output-'));
  try {
    const target = path.join(root, 'target');
    await fsp.mkdir(target);
    const sourcePath = path.join(target, 'test.php');
    const resolved = await resolveCollections(['Props'], {
      Props: definition({
        type: 'extract',
        source: { scope: 'target', path: 'test.php' },
        extract: { type: 'fileFoundry.regex', options: { pattern: "'(?<name>[A-Za-z_]+)'" } }
      })
    }, context(root, {
      targetDirectory: target,
      placeholderContext: {},
      virtualFiles: new Map([[sourcePath, Buffer.from("'title', 'icon'")]]),
      extractorRegistry: new ExtractorRegistry(),
      safeContext: {}
    }));
    assert.deepStrictEqual(resolved.Props.map((record) => record.name), ['title', 'icon']);
    await assert.rejects(fsp.access(sourcePath), /ENOENT/u);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('extract collections prepend stable initial records when their optional source is missing', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-initial-records-'));
  try {
    const target = path.join(root, 'target');
    await fsp.mkdir(target);
    const resolved = await resolveCollections(['Props'], {
      Props: definition({
        type: 'extract',
        source: { scope: 'target', path: 'missing.php' },
        extract: { type: 'fileFoundry.regex', options: { pattern: "'(?<name>[A-Za-z_]+)'" } },
        onMissing: 'empty',
        initialRecords: [{ name: 'id' }, { name: 'custom_class' }],
        uniqueBy: 'name'
      })
    }, context(root, {
      targetDirectory: target,
      placeholderContext: {},
      extractorRegistry: new ExtractorRegistry(),
      safeContext: {}
    }));
    assert.deepStrictEqual(resolved.Props.map((record) => record.name), ['id', 'custom_class']);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('collections resolve once and enforce empty behavior', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-empty-'));
  try {
    const baseContext = {
      blueprintDirectory: root, targetDirectory: root, workspaceDirectory: root,
      placeholderContext: {}, trusted: true, log() {}
    };
    const collections = { Empty: definition({ source: { scope: 'target', path: '.' } }) };
    const result = await resolveCollections(['Empty', 'Empty'], collections, baseContext);
    assert.deepStrictEqual(result.Empty, []);
    await assert.rejects(resolveCollections(['Empty'], {
      Empty: { ...collections.Empty, onEmpty: 'error' }
    }, baseContext), /is empty/);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('staged forge input resolution preserves prompts collected before an output route', async () => {
  const manifest = normalizeBlueprintManifest({
    version: 1,
    prompts: [{ key: 'StoryProps', type: 'input', title: 'Story props' }]
  }, 'Staged Prompts');
  const template = parseTemplate('[[Prompt:StoryProps]]', 'story.txt', 'Staged Prompts');
  const result = await resolveRequiredForgeInputs({
    vscode: { window: { showInputBox: async () => { throw new Error('Prompt repeated'); } } },
    inspectedSources: [{ template, pathPlaceholderMatches: [] }],
    manifest,
    builtInContext: { FolderName: 'target', FolderLetter: 't', DirName: 'workspace', DirLetter: 'w' },
    initialInputs: { prompts: { StoryProps: 'title, description' }, rawPrompts: { StoryProps: 'title, description' } },
    collectionContext: {},
    promptContext: {}
  });
  assert.equal(result.prompts.StoryProps, 'title, description');
});

test('collection sources resolve after a single-record prompt and feed a later checklist', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-dependent-collections-'));
  try {
    const workspace = path.join(root, 'workspace');
    const components = path.join(workspace, 'components');
    const target = path.join(workspace, 'target');
    await Promise.all([fsp.mkdir(components, { recursive: true }), fsp.mkdir(target, { recursive: true })]);
    await fsp.writeFile(path.join(components, 'button.js'), 'prop:title\nprop:url\n');
    const manifest = normalizeBlueprintManifest({
      version: 1,
      collections: {
        Components: {
          type: 'filesystem', source: { scope: 'workspace', path: 'components' },
          kind: 'file', include: ['*.js']
        },
        Props: {
          type: 'extract',
          source: { scope: 'workspace', path: 'components/[[Prompt:Component.relativePath]]' },
          extract: { type: 'fileFoundry.regex', options: { pattern: 'prop:(?<name>[A-Za-z]+)' } }
        }
      },
      prompts: [
        {
          key: 'Component', type: 'selectFromCollection', collection: 'Components',
          selection: { mode: 'single', required: true }, option: { label: '[[Item:name]]' }
        },
        {
          key: 'Props', type: 'selectFromCollection', collection: 'Props',
          selection: { mode: 'multi', defaultSelected: 'all' }, option: { label: '[[Item:name]]' }
        }
      ]
    }, 'Dependent Collections');
    const template = parseTemplate(
      '[[#each Prompt:Props as Prop]][[Prop:name]] [[/each]]',
      'props.txt',
      'Dependent Collections'
    );
    const result = await resolveRequiredForgeInputs({
      vscode: { window: {
        showQuickPick: async (items, options) => options.canPickMany ? items : items[0],
        showWarningMessage: async () => undefined
      } },
      inspectedSources: [{ template, pathPlaceholderMatches: [] }],
      manifest,
      builtInContext: { FolderName: 'target', FolderLetter: 't', DirName: 'workspace', DirLetter: 'w' },
      collectionContext: {
        blueprintDirectory: root, targetDirectory: target, workspaceDirectory: workspace,
        trusted: true, extractorRegistry: new ExtractorRegistry(), safeContext: {}
      },
      promptContext: { targetDirectory: target, targetUri: { fsPath: target }, workspaceDirectories: [workspace] }
    });
    assert.equal(result.prompts.Component.name, 'button.js');
    assert.deepStrictEqual(result.prompts.Props.map((record) => record.name), ['title', 'url']);
    assert.equal(result.collections.Props.length, 2);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});
