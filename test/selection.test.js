'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');
const { collectOutputSelection } = require('../src/selection/collectOutputSelection');
const { hasExistingPreselectedFiles } = require('../src/selection/hasExistingPreselectedFiles');
const { matchSelectionEntries } = require('../src/selection/matchSelectionEntries');
const { resolveSelectedSources } = require('../src/selection/resolveSelectedSources');

const fsp = fs.promises;

const entries = [
  entry('Component.js', 'file'),
  entry('Component.scss', 'file'),
  entry('Component.test.js', 'file'),
  entry('index.js', 'file'),
  entry('stories', 'directory'),
  entry('stories/Component.stories.js', 'file'),
  entry('stories/fixture.json', 'file'),
  entry('assets', 'directory'),
  entry('assets/icon.bin', 'file')
];

test('missing or disabled file selection generates every source', () => {
  const selection = { enabled: false, includeUnlisted: true, options: [] };
  assert.equal(resolveSelectedSources(selection, entries, new Map(), []).length, entries.length);
});

test('matches literal files, placeholder names, and directory subtrees', () => {
  const localEntries = [
    ...entries,
    entry('[[FolderName>PascalCase]].js', 'file')
  ];
  const selection = configuredSelection([
    option('component', ['[[FolderName>PascalCase]].js']),
    option('story', ['stories'])
  ], false);
  const matches = matchSelectionEntries(selection, localEntries);
  assert.deepEqual([...matches.get('component')], ['[[FolderName>PascalCase]].js']);
  assert.deepEqual([...matches.get('story')].sort(), [
    'stories',
    'stories/Component.stories.js',
    'stories/fixture.json'
  ]);
});

test('matches explicit globs including dot-aware nested files', () => {
  const selection = configuredSelection([
    option('stories', [{ glob: '**/*.stories.js' }])
  ], false);
  const matches = matchSelectionEntries(selection, entries);
  assert.ok(matches.get('stories').has('stories/Component.stories.js'));
  assert.ok(matches.get('stories').has('stories'));
});

test('rejects unsafe, placeholder-containing, and empty globs', () => {
  assert.throws(() => matchSelectionEntries(
    configuredSelection([option('bad', [{ glob: '../*.js' }])], false), entries
  ), /Unsafe/u);
  assert.throws(() => matchSelectionEntries(
    configuredSelection([option('bad', [{ glob: '**\/[[FolderName]].js' }])], false), entries
  ), /cannot contain placeholder/u);
  assert.throws(() => matchSelectionEntries(
    configuredSelection([option('bad', [{ glob: '**/*.missing' }])], false), entries
  ), /matches no blueprint sources/u);
});

test('required, selected, and overlapping options include each source once', () => {
  const selection = configuredSelection([
    { ...option('component', ['Component.js']), required: true },
    option('alsoComponent', ['Component.js']),
    option('styles', ['Component.scss'])
  ], false);
  const matches = matchSelectionEntries(selection, entries);
  const selected = resolveSelectedSources(selection, entries, matches, ['alsoComponent', 'styles']);
  assert.deepEqual(selected.map((item) => item.relativePath), ['Component.js', 'Component.scss']);
});

test('includeUnlisted true includes foundations while false generates selected options only', () => {
  const options = [option('component', ['Component.js'])];
  const withUnlisted = configuredSelection(options, true);
  const withoutUnlisted = configuredSelection(options, false);
  assert.equal(
    resolveSelectedSources(withUnlisted, entries, matchSelectionEntries(withUnlisted, entries), []).some((item) => item.relativePath === 'index.js'),
    true
  );
  assert.deepEqual(
    resolveSelectedSources(withoutUnlisted, entries, matchSelectionEntries(withoutUnlisted, entries), ['component']).map((item) => item.relativePath),
    ['Component.js']
  );
});

test('an empty optional selection can resolve to no output', () => {
  const selection = configuredSelection([option('styles', ['Component.scss'])], false);
  assert.deepEqual(resolveSelectedSources(selection, entries, matchSelectionEntries(selection, entries), []), []);
});

test('file-selection cancellation returns undefined', async () => {
  const vscode = { window: { showQuickPick: async () => undefined } };
  const result = await collectOutputSelection(vscode, configuredSelection([option('styles', ['Component.scss'])], false));
  assert.equal(result, undefined);
});

test('required and default-selected options are preselected for the UI', async () => {
  let presented;
  const vscode = {
    window: {
      showQuickPick: async (items) => {
        presented = items;
        return items.filter((item) => item.picked);
      },
      showWarningMessage: async () => undefined
    }
  };
  const selection = configuredSelection([
    { ...option('required', ['Component.js']), required: true },
    { ...option('default', ['Component.scss']), defaultSelected: true },
    option('optional', ['Component.test.js'])
  ], false);
  const selected = await collectOutputSelection(vscode, selection);
  assert.deepEqual(selected, ['required', 'default']);
  assert.equal(presented[0].description, 'Required');
});

test('clears every initial selection when any preselected option file already exists', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-selection-conflict-'));
  try {
    const target = path.join(root, 'components', 'test');
    await fsp.mkdir(target, { recursive: true });
    await fsp.writeFile(path.join(target, 'test.php'), 'existing');
    const localEntries = [
      entry('[[FolderName]].php', 'file'),
      entry('[[FolderName]].scss', 'file'),
      entry('[[FolderName]].stories.php', 'file')
    ];
    const selection = configuredSelection([
      { ...option('template', ['[[FolderName]].php']), defaultSelected: true },
      { ...option('style', ['[[FolderName]].scss']), defaultSelected: true },
      { ...option('stories', ['[[FolderName]].stories.php']), defaultSelected: true }
    ], false);
    const optionMatches = matchSelectionEntries(selection, localEntries);
    const suppressPreselection = await hasExistingPreselectedFiles({
      fileSelection: selection,
      optionMatches,
      sourceEntries: localEntries,
      targetDirectory: target,
      builtInContext: { FolderName: 'test', FolderLetter: 't', DirName: 'components', DirLetter: 'c' }
    });
    assert.equal(suppressPreselection, true);

    let presented;
    const vscode = { window: { showQuickPick: async (items) => { presented = items; return []; } } };
    assert.deepEqual(
      await collectOutputSelection(vscode, selection, { suppressPreselection }),
      []
    );
    assert(presented.every((item) => item.picked === false));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('defers prompt and custom path placeholders during preselection checks', async () => {
  const selection = configuredSelection([
    { ...option('setup', ['[[Prompt:ModuleName>KebabCase]]/class-setup.php']), defaultSelected: true },
    { ...option('helper', ['[[Custom:HelperName]].php']), defaultSelected: true }
  ], false);
  const localEntries = [
    entry('[[Prompt:ModuleName>KebabCase]]/class-setup.php', 'file'),
    entry('[[Custom:HelperName]].php', 'file')
  ];

  assert.equal(await hasExistingPreselectedFiles({
    fileSelection: selection,
    optionMatches: matchSelectionEntries(selection, localEntries),
    sourceEntries: localEntries,
    targetDirectory: path.join(os.tmpdir(), 'file-foundry-unresolved-selection'),
    builtInContext: { FolderName: 'tests', FolderLetter: 't', DirName: 'includes', DirLetter: 'i' }
  }), false);
});

/** @param {string} relativePath @param {string} type */
function entry(relativePath, type) {
  return { relativePath, sourcePath: `/blueprint/${relativePath}`, type };
}

/** @param {string} key @param {Array<string | object>} files */
function option(key, files) {
  return { key, label: key, files, required: false, defaultSelected: false };
}

/** @param {object[]} options @param {boolean} includeUnlisted */
function configuredSelection(options, includeUnlisted) {
  return {
    enabled: true,
    title: 'Select',
    placeholder: 'Choose',
    includeUnlisted,
    options
  };
}
