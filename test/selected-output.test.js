'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');
const { walkDirectory } = require('../src/filesystem/walkDirectory');
const { buildForgePlan } = require('../src/forge/buildForgePlan');
const { buildVirtualOutputFiles } = require('../src/forge/buildVirtualOutputFiles');
const { inspectSelectedSources } = require('../src/forge/inspectSelectedSources');
const { loadBlueprintManifest } = require('../src/manifests/loadBlueprintManifest');
const { createContext } = require('../src/placeholders/createContext');
const { resolveCustomPlaceholders } = require('../src/placeholders/resolveCustomPlaceholders');
const { createPromptDependencies } = require('../src/prompts/createPromptDependencies');
const { matchSelectionEntries } = require('../src/selection/matchSelectionEntries');
const { resolveSelectedSources } = require('../src/selection/resolveSelectedSources');

const fsp = fs.promises;

test('invalid placeholders block selected files but do not block unselected files', async () => {
  await withFixture(async ({ blueprint }) => {
    await fsp.writeFile(path.join(blueprint, 'good.txt'), 'Good [[FolderName]]');
    await fsp.writeFile(path.join(blueprint, 'bad.txt'), 'Bad [[UnknownPlaceholder]]');
    const entries = await walkDirectory(blueprint);
    const selection = fileSelection([
      selectionOption('good', ['good.txt']),
      selectionOption('bad', ['bad.txt'])
    ]);
    const matches = matchSelectionEntries(selection, entries);

    const good = resolveSelectedSources(selection, entries, matches, ['good']);
    assert.equal((await inspectSelectedSources(good)).length, 1);

    const bad = resolveSelectedSources(selection, entries, matches, ['bad']);
    await assert.rejects(inspectSelectedSources(bad), /Unknown placeholder/u);
  });
});

test('a prompt referenced only by an unselected file is not requested', async () => {
  await withFixture(async ({ blueprint }) => {
    await fsp.writeFile(path.join(blueprint, 'good.txt'), 'No prompt');
    await fsp.writeFile(path.join(blueprint, 'optional.txt'), '[[Prompt:Optional]]');
    const entries = await walkDirectory(blueprint);
    const selection = fileSelection([
      selectionOption('good', ['good.txt']),
      selectionOption('optional', ['optional.txt'])
    ]);
    const selected = resolveSelectedSources(
      selection,
      entries,
      matchSelectionEntries(selection, entries),
      ['good']
    );
    const inspected = await inspectSelectedSources(selected);
    const dependencies = createPromptDependencies(inspected, {
      placeholders: {},
      prompts: [{ key: 'Optional', type: 'input' }]
    });
    assert.deepEqual(dependencies.prompts, []);
  });
});

test('destination collisions are detected after prompt values resolve', async () => {
  await withFixture(async ({ blueprint, target }) => {
    await fsp.writeFile(path.join(blueprint, '[[Prompt:Name]].txt'), 'prompted');
    await fsp.writeFile(path.join(blueprint, 'same.txt'), 'literal');
    const inspected = await inspectSelectedSources(await walkDirectory(blueprint));
    await assert.rejects(buildForgePlan({
      blueprintDirectory: blueprint,
      targetDirectory: target,
      sourceEntries: inspected,
      context: {
        FolderName: 'reading-time',
        FolderLetter: 'r',
        DirName: 'molecules',
        DirLetter: 'm',
        Prompt: { Name: 'same' },
        Custom: {}
      }
    }), /same destination/u);
  });
});

test('virtual outputs defer prompt placeholders in destination paths', () => {
  const source = {
    type: 'file',
    relativePath: '[[Prompt:ModuleName>KebabCase]]/class-setup.php',
    sourceBuffer: Buffer.from('<?php')
  };
  const files = buildVirtualOutputFiles(
    [source],
    path.join(path.sep, 'useful-group', 'includes', 'tests'),
    { FolderName: 'tests', FolderLetter: 't', DirName: 'includes', DirLetter: 'i' }
  );

  assert.equal(files.size, 0);
});

test('a manifest-free blueprint retains the legacy forge plan', async () => {
  await withFixture(async ({ blueprint, target }) => {
    await fsp.mkdir(path.join(blueprint, '[[FolderName>PascalCase]]'));
    await fsp.writeFile(path.join(blueprint, '[[FolderName>PascalCase]]', 'index.js'), 'export default "[[FolderName]]";');
    const plan = await buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target });
    assert.deepEqual(plan.files.map((file) => file.destinationRelativePath), [path.join('ReadingTime', 'index.js')]);
    assert.equal(plan.files[0].contents.toString(), 'export default "reading-time";');
  });
});

test('the repository example runs through the complete manifest pipeline', async () => {
  const example = path.resolve(__dirname, '..', 'examples', 'blueprints', 'React Component');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-example-'));
  const target = path.join(root, 'components', 'molecules', 'reading-time');
  await fsp.mkdir(target, { recursive: true });
  try {
    const manifest = (await loadBlueprintManifest(example)).manifest;
    const entries = await walkDirectory(example);
    const optionMatches = matchSelectionEntries(manifest.fileSelection, entries);
    const selected = resolveSelectedSources(manifest.fileSelection, entries, optionMatches, ['component']);
    const inspected = await inspectSelectedSources(selected);
    const dependencies = createPromptDependencies(inspected, manifest);
    assert.deepEqual(dependencies.prompts.map((prompt) => prompt.key), ['DisplayName', 'RootElement']);

    const builtIn = createContext(target);
    const promptValues = { DisplayName: 'Reading Time', RootElement: 'section' };
    const customValues = resolveCustomPlaceholders(
      manifest.placeholders,
      builtIn,
      promptValues,
      dependencies.customKeys
    );
    const plan = await buildForgePlan({
      blueprintDirectory: example,
      targetDirectory: target,
      sourceEntries: inspected,
      context: { ...builtIn, Prompt: promptValues, Custom: customValues }
    });
    assert.deepEqual(plan.files.map((file) => file.destinationRelativePath), [
      path.join('ReadingTime', 'index.js'),
      path.join('ReadingTime', 'ReadingTime.js')
    ]);
    assert.equal(plan.files.some((file) => file.destinationRelativePath.endsWith('.scss')), false);
    assert.match(plan.files.find((file) => file.destinationRelativePath.endsWith('ReadingTime.js')).contents.toString(), /tag: Tag = 'section'/u);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

/** @param {(fixture: {blueprint: string, target: string}) => Promise<void>} callback */
async function withFixture(callback) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-selected-'));
  const blueprint = path.join(root, 'Blueprint');
  const target = path.join(root, 'components', 'molecules', 'reading-time');
  await fsp.mkdir(blueprint, { recursive: true });
  await fsp.mkdir(target, { recursive: true });
  try {
    await callback({ blueprint, target });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

/** @param {object[]} options */
function fileSelection(options) {
  return { enabled: true, includeUnlisted: false, options };
}

/** @param {string} key @param {string[]} files */
function selectionOption(key, files) {
  return { key, files, required: false };
}
