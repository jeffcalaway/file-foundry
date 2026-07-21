'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');
const { discoverBlueprints } = require('../src/blueprints/discoverBlueprints');
const { walkDirectory } = require('../src/filesystem/walkDirectory');
const { loadBlueprintManifest } = require('../src/manifests/loadBlueprintManifest');
const { validateBlueprintManifest } = require('../src/manifests/validateBlueprintManifest');

const fsp = fs.promises;

test('loads a blueprint without a manifest as a legacy blueprint', async () => {
  await withBlueprint(async (blueprint) => {
    const loaded = await loadBlueprintManifest(blueprint);
    assert.equal(loaded.manifest, undefined);
    assert.deepEqual(loaded.warnings, []);
  });
});

test('loads and normalizes valid version 1 metadata', async () => {
  await withBlueprint(async (blueprint) => {
    await writeManifest(blueprint, {
      version: 1,
      name: 'Atomic Component',
      description: 'Selectable component files.',
      omitEmptyFiles: true
    });
    const loaded = await loadBlueprintManifest(blueprint);
    assert.equal(loaded.manifest.name, 'Atomic Component');
    assert.equal(loaded.manifest.description, 'Selectable component files.');
    assert.equal(loaded.manifest.omitEmptyFiles, true);
    assert.deepEqual(loaded.manifest.prompts, []);
    assert.equal(loaded.manifest.fileSelection.enabled, false);
  });
});

test('validates omitEmptyFiles as a boolean', () => {
  assert.throws(
    () => validateBlueprintManifest({ version: 1, omitEmptyFiles: 'yes' }, 'Invalid'),
    /omitEmptyFiles.*boolean/u
  );
});

test('validates assignment formatters and useful-group workspace edits', () => {
  const manifest = {
    version: 1,
    prompts: [{ key: 'ModuleName', type: 'input' }],
    fileSelection: {
      enabled: true,
      options: [
        { key: 'parentModule', label: 'Parent Module', files: ['class.php'] },
        { key: 'functions', label: 'Functions', files: ['functions.php'] }
      ]
    },
    formatters: [{ type: 'alignAssignments', sourceFiles: ['class.php'] }],
    workspaceEdits: [{ type: 'usefulGroupPhpRegistry' }]
  };
  assert.doesNotThrow(() => validateBlueprintManifest(manifest, 'Package'));
  assert.throws(
    () => validateBlueprintManifest({ ...manifest, formatters: [{ type: 'unknown', sourceFiles: ['class.php'] }] }, 'Package'),
    /type must be alignAssignments/u
  );
  assert.throws(
    () => validateBlueprintManifest({ ...manifest, workspaceEdits: [{ type: 'usefulGroupPhpRegistry', functionsOption: 'missing' }] }, 'Package'),
    /undefined file-selection option/u
  );
});

test('validates useful-group namespace auto values on input prompts', () => {
  assert.doesNotThrow(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Namespace', type: 'input', autoValue: { type: 'usefulGroupPhpNamespace' } }]
  }, 'Package'));
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Namespace', type: 'input', autoValue: { type: 'unknown' } }]
  }, 'Package'), /autoValue\.type must be usefulGroupPhpNamespace/u);
});

test('validates WordPress template-block output routes', () => {
  const manifest = {
    version: 1,
    fileSelection: {
      enabled: true,
      options: [{
        key: 'templateBlock', label: 'Template Block',
        files: ['_page-builder/[[FolderName]].php', '_page-builder/[[FolderName]].block.php']
      }]
    },
    outputRoutes: [{
      type: 'wordpressTemplateBlock', option: 'templateBlock',
      legacySource: '_page-builder/[[FolderName]].php', modernSource: '_page-builder/[[FolderName]].block.php'
    }]
  };
  assert.doesNotThrow(() => validateBlueprintManifest(manifest, 'WordPress Component'));
  assert.throws(() => validateBlueprintManifest({
    ...manifest,
    outputRoutes: [{
      type: 'wordpressTemplateBlock', option: 'missing',
      legacySource: '_page-builder/file.php', modernSource: '_page-builder/file.block.php'
    }]
  }, 'WordPress Component'), /undefined file-selection option/u);
});

test('validates collection initial records and missing-source behavior', () => {
  assert.doesNotThrow(() => validateBlueprintManifest({
    version: 1,
    collections: {
      Props: {
        type: 'extract', source: { scope: 'target', path: 'component.php' },
        extract: { type: 'fileFoundry.regex' }, onMissing: 'empty',
        initialRecords: [{ name: 'id' }, { name: 'custom_class' }], uniqueBy: 'name'
      }
    }
  }, 'Component'));
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    collections: {
      Props: {
        type: 'extract', source: { scope: 'target', path: 'component.php' },
        extract: { type: 'fileFoundry.regex' }, onMissing: 'skip'
      }
    }
  }, 'Component'), /invalid onMissing/u);
});

test('falls back to the directory name for missing or empty manifest name', async () => {
  await withBlueprint(async (blueprint) => {
    await writeManifest(blueprint, { version: 1, name: '   ' });
    assert.equal((await loadBlueprintManifest(blueprint)).manifest.name, 'Blueprint');
  });
});

for (const [label, source, expected] of [
  ['missing version', '{}', /required "version"/u],
  ['unsupported version', '{"version":2}', /Unsupported manifest version/u],
  ['invalid JSON', '{"version":', /Invalid JSON/u],
  ['duplicate JSON keys', '{"version":1,"version":1}', /Duplicate JSON key/u]
]) {
  test(`rejects manifest with ${label}`, async () => {
    await withBlueprint(async (blueprint) => {
      await fsp.writeFile(path.join(blueprint, 'blueprint.json'), source);
      await assert.rejects(loadBlueprintManifest(blueprint), expected);
    });
  });
}

test('reports unknown top-level manifest properties as warnings', () => {
  const result = validateBlueprintManifest({ version: 1, futureFeature: true }, 'Example');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /futureFeature/u);
});

test('discovery exposes metadata and isolates invalid manifests', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-discovery-'));
  try {
    const valid = path.join(root, 'Valid');
    const invalid = path.join(root, 'Invalid');
    await fsp.mkdir(valid);
    await fsp.mkdir(invalid);
    await writeManifest(valid, { version: 1, name: 'Friendly Name', description: 'Helpful text' });
    await fsp.writeFile(path.join(invalid, 'blueprint.json'), '{bad');

    const blueprints = await discoverBlueprints(root);
    assert.equal(blueprints.find((item) => item.directoryName === 'Valid').name, 'Friendly Name');
    assert.equal(blueprints.find((item) => item.directoryName === 'Valid').description, 'Helpful text');
    assert.ok(blueprints.find((item) => item.directoryName === 'Invalid').manifestError);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('blueprint.json is always excluded from walked output', async () => {
  await withBlueprint(async (blueprint) => {
    await writeManifest(blueprint, { version: 1 });
    await fsp.writeFile(path.join(blueprint, 'output.txt'), 'output');
    await fsp.mkdir(path.join(blueprint, '.file-foundry'));
    await fsp.writeFile(path.join(blueprint, '.file-foundry', 'icon.svg'), '<svg/>');
    assert.deepEqual((await walkDirectory(blueprint)).map((entry) => entry.relativePath), ['output.txt']);
  });
});

test('validates theme-aware pick option icon paths', () => {
  assert.doesNotThrow(() => validateBlueprintManifest({
    version: 1,
    prompts: [{
      key: 'Icon', type: 'pick', options: [{
        label: 'Book', value: 'book',
        iconPath: { light: '.file-foundry/dark/book.svg', dark: '.file-foundry/light/book.svg' }
      }]
    }]
  }, 'Icons'));
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Icon', type: 'pick', options: [{ label: 'Book', value: 'book', iconPath: '../book.svg' }] }]
  }, 'Icons'), /safe relative path/u);
});

test('validates prompt defaults, values, identifiers, and regular expressions', () => {
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Bad-Key', type: 'input' }]
  }, 'Bad'), /must match/u);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Name', type: 'input', validation: { pattern: '[' } }]
  }, 'Bad'), /valid regular expression/u);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Language', type: 'pick', options: [
      { label: 'One', value: 'js' },
      { label: 'Two', value: 'js' }
    ] }]
  }, 'Bad'), /duplicate option value/u);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Language', type: 'pick', default: 'ts', options: [{ label: 'JS', value: 'js' }] }]
  }, 'Bad'), /undeclared option value/u);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Name', type: 'mystery' }]
  }, 'Bad'), /must be one of/u);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Name', type: 'input', default: '[[Prompt:Other]]' }]
  }, 'Bad'), /built-in placeholders only/u);
});

test('validates file-selection option keys and definitions', () => {
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    fileSelection: {
      enabled: true,
      options: [
        { key: 'same', label: 'One', files: ['one.js'] },
        { key: 'same', label: 'Two', files: ['two.js'] }
      ]
    }
  }, 'Bad'), /Duplicate file-selection option key/u);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    fileSelection: { enabled: true, options: [] }
  }, 'Bad'), /non-empty array/u);
});

/** @param {(blueprint: string) => Promise<void>} callback */
async function withBlueprint(callback) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-manifest-'));
  const blueprint = path.join(root, 'Blueprint');
  await fsp.mkdir(blueprint);
  try {
    await callback(blueprint);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

/** @param {string} blueprint @param {object} value */
function writeManifest(blueprint, value) {
  return fsp.writeFile(path.join(blueprint, 'blueprint.json'), JSON.stringify(value));
}
