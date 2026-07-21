'use strict';

const assert = require('assert').strict;
const { normalizeBlueprintManifest } = require('../src/manifests/normalizeBlueprintManifest');
const { validateBlueprintManifest } = require('../src/manifests/validateBlueprintManifest');
const { test } = require('./harness');

function filesystem(overrides = {}) {
  return { type: 'filesystem', source: { scope: 'target', path: '.' }, ...overrides };
}

test('collection manifests normalize filesystem and selection defaults', () => {
  const source = {
    version: 1,
    collections: { Files: { source: { scope: 'target', path: '.' } } },
    prompts: [{ key: 'Selected', type: 'selectFromCollection', collection: 'Files' }]
  };
  validateBlueprintManifest(source, 'Collections');
  const manifest = normalizeBlueprintManifest(source, 'Collections');
  assert.equal(manifest.collections.Files.type, 'filesystem');
  assert.equal(manifest.collections.Files.kind, 'any');
  assert.equal(manifest.collections.Files.recursive, false);
  assert.deepEqual(manifest.collections.Files.include, []);
  assert.deepEqual(manifest.collections.Files.sort, { by: 'name', direction: 'ascending', caseSensitive: false, numeric: true });
  assert.deepEqual(manifest.prompts[0].selection, { mode: 'multi', defaultSelected: 'none', required: false, order: 'source' });
  assert.equal(manifest.prompts[0].option.label, '[[Item:name]]');
});

test('collection manifests validate names, types, kinds, source scopes, depth, and empty behavior', () => {
  const failures = [
    [{ 'Bad-Name': filesystem() }, /collection name/],
    [{ Files: filesystem({ type: 'remote' }) }, /type filesystem or extract/],
    [{ Files: filesystem({ kind: 'socket' }) }, /invalid kind/],
    [{ Files: filesystem({ source: { scope: 'planet', path: '.' } }) }, /requires source.scope/],
    [{ Files: filesystem({ maxDepth: -1 }) }, /maxDepth/],
    [{ Files: filesystem({ recursive: 'yes' }) }, /recursive must be a boolean/],
    [{ Files: filesystem({ onEmpty: 'ignore' }) }, /onEmpty/]
  ];
  for (const [collections, expected] of failures) {
    assert.throws(() => validateBlueprintManifest({ version: 1, collections }, 'Bad'), expected);
  }
});

test('collection manifests reject unsafe globs and invalid sort definitions', () => {
  for (const value of ['/absolute/*.js', '../*.js', '']) {
    assert.throws(() => validateBlueprintManifest({ version: 1, collections: {
      Files: filesystem({ include: [value] })
    } }, 'Bad'), /glob/);
  }
  assert.throws(() => validateBlueprintManifest({ version: 1, collections: {
    Files: filesystem({ sort: { by: 'unknown' } })
  } }, 'Bad'), /sort/);
  assert.doesNotThrow(() => validateBlueprintManifest({ version: 1, collections: {
    Results: { type: 'extract', source: { scope: 'target', path: 'a.txt' }, extract: { type: 'user.values' }, sort: { by: 'value' } }
  } }, 'Good'));
});

test('extract collection manifests require extractor definitions and object options', () => {
  assert.throws(() => validateBlueprintManifest({ version: 1, collections: {
    Values: { type: 'extract', source: { scope: 'target', path: 'a.txt' } }
  } }, 'Bad'), /requires extract.type/);
  assert.throws(() => validateBlueprintManifest({ version: 1, collections: {
    Values: { type: 'extract', source: { scope: 'target', path: 'a.txt' }, extract: { type: 'user.values', options: [] } }
  } }, 'Bad'), /options must be an object/);
});

test('collection source paths allow scalar and single-record prompt dependencies', () => {
  assert.doesNotThrow(() => validateBlueprintManifest({
    version: 1, collections: { Files: filesystem({ source: { scope: 'workspace', path: '[[Prompt:Area]]' } }) },
    prompts: [{ key: 'Area', type: 'input' }]
  }, 'Good'));
  assert.doesNotThrow(() => validateBlueprintManifest({
    version: 1,
    placeholders: { AreaPath: { value: '[[Prompt:Area]]' } },
    collections: { Files: filesystem({ source: { scope: 'workspace', path: '[[Custom:AreaPath]]' } }) },
    prompts: [{ key: 'Area', type: 'input' }]
  }, 'Good'));
  assert.doesNotThrow(() => validateBlueprintManifest({
    version: 1,
    placeholders: { Area: { value: '[[FolderName>KebabCase]]' } },
    collections: { Files: filesystem({ source: { scope: 'workspace', path: '[[Custom:Area]]' } }) }
  }, 'Good'));

  const components = filesystem({ source: { scope: 'workspace', path: 'components' } });
  assert.doesNotThrow(() => validateBlueprintManifest({
    version: 1,
    collections: {
      Components: components,
      Props: { type: 'extract', source: { scope: 'workspace', path: 'components/[[Prompt:Component.relativePath]]' }, extract: { type: 'fileFoundry.regex' } }
    },
    prompts: [{
      key: 'Component', type: 'selectFromCollection', collection: 'Components',
      selection: { mode: 'single' }
    }]
  }, 'Good'));
});

test('collection source prompt dependencies reject invalid usage and cycles', () => {
  const components = filesystem({ source: { scope: 'workspace', path: 'components' } });
  assert.throws(() => validateBlueprintManifest({
    version: 1, collections: { Files: filesystem({ source: { scope: 'workspace', path: '[[Prompt:Missing]]' } }) }
  }, 'Bad'), /undefined prompt/);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    collections: { Components: components, Files: filesystem({ source: { scope: 'workspace', path: '[[Prompt:Many.name]]' } }) },
    prompts: [{ key: 'Many', type: 'selectFromCollection', collection: 'Components' }]
  }, 'Bad'), /multi-select/);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    collections: { Components: components, Files: filesystem({ source: { scope: 'workspace', path: '[[Prompt:One]]' } }) },
    prompts: [{ key: 'One', type: 'selectFromCollection', collection: 'Components', selection: { mode: 'single' } }]
  }, 'Bad'), /must reference a field/);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    collections: { Files: filesystem({ source: { scope: 'workspace', path: '[[Prompt:Area.name]]' } }) },
    prompts: [{ key: 'Area', type: 'input' }]
  }, 'Bad'), /scalar prompt/);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    collections: { Files: filesystem({ source: { scope: 'workspace', path: '[[Prompt:File.relativePath]]' } }) },
    prompts: [{ key: 'File', type: 'selectFromCollection', collection: 'Files', selection: { mode: 'single' } }]
  }, 'Bad'), /Circular collection\/prompt dependency/);
});

test('collection selection prompts validate references, modes, defaults, and option syntax', () => {
  const manifest = (prompt) => ({ version: 1, collections: { Files: filesystem() }, prompts: [prompt] });
  assert.throws(() => validateBlueprintManifest(manifest({ key: 'Pick', type: 'selectFromCollection', collection: 'Missing' }), 'Bad'), /declared collection/);
  assert.throws(() => validateBlueprintManifest(manifest({ key: 'Pick', type: 'selectFromCollection', collection: 'Files', selection: { mode: 'one' } }), 'Bad'), /selection is invalid/);
  assert.throws(() => validateBlueprintManifest(manifest({ key: 'Pick', type: 'selectFromCollection', collection: 'Files', selection: { mode: 'single', defaultSelected: 'all' } }), 'Bad'), /first, none/);
  assert.throws(() => validateBlueprintManifest(manifest({ key: 'Pick', type: 'selectFromCollection', collection: 'Files', option: { label: '[[#each Collection:Files as X]]' } }), 'Bad'), /Loop.*directives|cannot contain loops/);
  assert.throws(() => validateBlueprintManifest(manifest({ key: 'Pick', type: 'selectFromCollection', collection: 'Files', option: { label: '[[Item:name>Unknown]]' } }), 'Bad'), /unknown transformation/);
});

test('manifest values reject loops outside text file contents', () => {
  assert.throws(() => validateBlueprintManifest({
    version: 1, name: '[[#each Collection:Files as File]]'
  }, 'Bad'), /Loop.*directives are unsupported/);
});

test('manifest values reject conditional blocks outside text file contents', () => {
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    prompts: [{ key: 'Name', type: 'input', title: '[[#if true]]Name[[/if]]' }]
  }, 'Bad'), /conditional directives are unsupported/);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    placeholders: { Name: { value: '[[#if true]]value[[/if]]' } }
  }, 'Bad'), /conditional directives are unsupported/);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    collections: { Files: filesystem({ source: { scope: 'target', path: '[[#if true]].[[/if]]' } }) }
  }, 'Bad'), /conditional directives are unsupported/);
});
