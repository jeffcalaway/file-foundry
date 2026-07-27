'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');
const { buildForgePlan } = require('../src/forge/buildForgePlan');
const { executeForgePlan } = require('../src/forge/executeForgePlan');
const { createContext } = require('../src/placeholders/createContext');
const { resolveOutputRoutes } = require('../src/routes/resolveOutputRoutes');
const { preRouteSources } = require('../src/routes/preRouteSources');

const fsp = fs.promises;

test('resolves prompts for earlier selected file groups before an active output route', () => {
  const sources = [
    { type: 'file', relativePath: 'test.stories.php' },
    { type: 'file', relativePath: '_page-builder/test.php' },
    { type: 'file', relativePath: '_page-builder/test.block.php' },
    { type: 'file', relativePath: 'test.block.php' }
  ];
  const manifest = {
    fileSelection: { options: [
      { key: 'stories' }, { key: 'templateBlock' }, { key: 'gutenberg' }
    ] },
    outputRoutes: [{
      option: 'templateBlock',
      legacySource: '_page-builder/test.php',
      modernSource: '_page-builder/test.block.php'
    }]
  };
  const matches = new Map([
    ['stories', new Set(['test.stories.php'])],
    ['templateBlock', new Set(['_page-builder/test.php', '_page-builder/test.block.php'])],
    ['gutenberg', new Set(['test.block.php'])]
  ]);
  assert.deepStrictEqual(
    preRouteSources(manifest, ['stories', 'templateBlock', 'gutenberg'], sources, matches),
    [sources[0]]
  );
});

test('includes a parent-directory route source in early prompt resolution', () => {
  const parent = { type: 'file', relativePath: 'class-[[Prompt:ModuleName>KebabCase]].php' };
  const manifest = {
    fileSelection: { options: [{ key: 'parentModule' }] },
    outputRoutes: [{
      type: 'parentDirectory',
      option: 'parentModule',
      source: parent.relativePath
    }]
  };
  const matches = new Map([['parentModule', new Set([parent.relativePath])]]);

  assert.deepStrictEqual(
    preRouteSources(manifest, ['parentModule'], [parent], matches),
    [parent]
  );
});

function selectedSources(root) {
  return [
    { type: 'file', relativePath: '[[FolderName]].php', sourcePath: path.join(root, 'part.php') },
    { type: 'directory', relativePath: '_page-builder', sourcePath: path.join(root, '_page-builder') },
    { type: 'file', relativePath: '_page-builder/[[FolderName]].php', sourcePath: path.join(root, 'block.php') },
    { type: 'file', relativePath: '_page-builder/[[FolderName]].block.php', sourcePath: path.join(root, 'modern-block.php') }
  ];
}

function options(root, target, pickIndex, warnings) {
  return {
    vscode: { window: {
      showQuickPick: async (items) => items[pickIndex],
      showWarningMessage: async (message) => { warnings.push(message); }
    } },
    manifest: { outputRoutes: [{
      type: 'wordpressTemplateBlock', option: 'templateBlock',
      legacySource: '_page-builder/[[FolderName]].php', modernSource: '_page-builder/[[FolderName]].block.php'
    }] },
    selectedOutputKeys: ['templatePart', 'templateBlock'],
    selectedSources: selectedSources(root),
    targetDirectory: target,
    workspaceDirectories: [root],
    builtInContext: { FolderName: 'test' }
  };
}

test('routes legacy template blocks to a nested page-builder folder without emitting _page-builder', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-route-'));
  try {
    const usefulGroup = path.join(root, 'useful-group');
    const target = path.join(usefulGroup, 'template-parts', 'molecules', 'test');
    const pageBuilder = path.join(usefulGroup, 'template-blocks', 'general', 'page-builder');
    await Promise.all([fsp.mkdir(target, { recursive: true }), fsp.mkdir(pageBuilder, { recursive: true })]);
    const warnings = [];
    const result = await resolveOutputRoutes(options(root, target, 0, warnings));
    assert.equal(warnings.length, 0);
    assert(!result.selectedSources.some((entry) => entry.type === 'directory' && entry.relativePath === '_page-builder'));
    assert.equal(
      result.destinationOverrides.get('_page-builder/[[FolderName]].php').destinationPath,
      path.join(pageBuilder, 'test.php')
    );
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('routes modern template blocks to a component-local .block.php file', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-route-target-'));
  try {
    const target = path.join(root, 'useful-group', 'template-parts', 'atoms', 'test');
    await fsp.mkdir(target, { recursive: true });
    const warnings = [];
    const result = await resolveOutputRoutes(options(root, target, 1, warnings));
    assert.equal(warnings.length, 0);
    assert.equal(
      result.destinationOverrides.get('_page-builder/[[FolderName]].block.php').destinationPath,
      path.join(target, 'test.block.php')
    );
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('routes a prompted parent module to the clicked folder parent', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-parent-route-'));
  try {
    const target = path.join(root, 'useful-group', 'includes', 'tests');
    await fsp.mkdir(target, { recursive: true });
    const source = {
      type: 'file',
      relativePath: 'class-[[Prompt:ModuleName>KebabCase]].php'
    };
    const result = await resolveOutputRoutes({
      vscode: { window: {} },
      manifest: { outputRoutes: [{
        type: 'parentDirectory',
        option: 'parentModule',
        source: source.relativePath
      }] },
      selectedOutputKeys: ['parentModule'],
      selectedSources: [source],
      targetDirectory: target,
      workspaceDirectories: [root],
      builtInContext: { Prompt: { ModuleName: 'Tests' } }
    });

    assert.equal(
      result.destinationOverrides.get(source.relativePath).destinationPath,
      path.join(root, 'useful-group', 'includes', 'class-tests.php')
    );
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('forge planning writes a routed block to its override and never creates _page-builder', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-route-forge-'));
  try {
    const blueprint = path.join(root, 'blueprint');
    const sourceDirectory = path.join(blueprint, '_page-builder');
    const target = path.join(root, 'useful-group', 'template-parts', 'atoms', 'test');
    const pageBuilder = path.join(root, 'useful-group', 'template-blocks', 'general', 'page-builder');
    await Promise.all([
      fsp.mkdir(sourceDirectory, { recursive: true }),
      fsp.mkdir(target, { recursive: true }),
      fsp.mkdir(pageBuilder, { recursive: true })
    ]);
    const sourcePath = path.join(sourceDirectory, '[[FolderName]].php');
    await fsp.writeFile(sourcePath, 'block');
    const relativePath = '_page-builder/[[FolderName]].php';
    const destinationPath = path.join(pageBuilder, 'test.php');
    const plan = await buildForgePlan({
      blueprintDirectory: blueprint,
      targetDirectory: target,
      sourceEntries: [{ type: 'file', sourcePath, relativePath }],
      context: createContext(target),
      destinationOverrides: new Map([[relativePath, { destinationPath, rootDirectory: pageBuilder }]])
    });
    assert.equal(plan.files[0].destinationPath, destinationPath);
    await executeForgePlan(plan, 'overwrite');
    assert.equal(await fsp.readFile(destinationPath, 'utf8'), 'block');
    await assert.rejects(fsp.access(path.join(target, '_page-builder')), /ENOENT/u);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('skips legacy template blocks and warns when template-blocks or page-builder is missing', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-route-warning-'));
  try {
    const usefulGroup = path.join(root, 'useful-group');
    const target = path.join(usefulGroup, 'template-parts', 'atoms', 'test');
    await fsp.mkdir(target, { recursive: true });
    const missingBlocksWarnings = [];
    const missingBlocks = await resolveOutputRoutes(options(root, target, 0, missingBlocksWarnings));
    assert.match(missingBlocksWarnings[0], /no template-blocks folder/u);
    assert(!missingBlocks.selectedSources.some((entry) => entry.relativePath.includes('_page-builder')));

    await fsp.mkdir(path.join(usefulGroup, 'template-blocks'));
    const missingBuilderWarnings = [];
    const missingBuilder = await resolveOutputRoutes(options(root, target, 0, missingBuilderWarnings));
    assert.match(missingBuilderWarnings[0], /no page-builder folder/u);
    assert(!missingBuilder.selectedSources.some((entry) => entry.relativePath.includes('_page-builder')));
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});
