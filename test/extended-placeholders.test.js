'use strict';

const assert = require('assert').strict;
const { test } = require('./harness');
const { validateBlueprintManifest } = require('../src/manifests/validateBlueprintManifest');
const { parsePlaceholder } = require('../src/placeholders/parsePlaceholder');
const { replacePlaceholders } = require('../src/placeholders/replacePlaceholders');
const { resolveCustomPlaceholders } = require('../src/placeholders/resolveCustomPlaceholders');
const { scanPlaceholders } = require('../src/placeholders/scanPlaceholders');
const { createPromptDependencies } = require('../src/prompts/createPromptDependencies');

test('parses custom and prompt placeholder forms', () => {
  assert.deepEqual(parsePlaceholder('[[Custom:ComponentName]]'), {
    namespace: 'Custom',
    key: 'ComponentName',
    placeholder: 'Custom:ComponentName',
    transform: undefined,
    expression: '[[Custom:ComponentName]]'
  });
  assert.equal(parsePlaceholder('[[Custom:ComponentName>PascalCase]]').transform, 'PascalCase');
  assert.equal(parsePlaceholder('[[Prompt:Description]]').namespace, 'Prompt');
  assert.equal(parsePlaceholder('[[Prompt:Description>SentenceCase]]').transform, 'SentenceCase');
});

for (const invalid of [
  '[[Custom:]]',
  '[[Prompt:]]',
  '[[Unknown:Value]]',
  '[[Prompt:Component Name]]',
  '[[Prompt:ComponentName>UnknownTransform]]',
  '[[Custom:Name>LowerCase>PascalCase]]'
]) {
  test(`rejects extended placeholder syntax: ${invalid}`, () => {
    assert.throws(() => parsePlaceholder(invalid));
  });
}

test('resolves built-in, prompt, and multi-level custom dependencies', () => {
  const definitions = {
    Base: { value: '[[FolderName>PascalCase]]' },
    Label: { value: '[[Prompt:DisplayName]]' },
    Combined: { value: '[[Custom:Base]] — [[Custom:Label]]' },
    Wrapped: { value: 'Value: [[Custom:Combined]]' }
  };
  const values = resolveCustomPlaceholders(
    definitions,
    { FolderName: 'reading-time' },
    { DisplayName: 'Reading time component' },
    ['Wrapped']
  );
  assert.equal(values.Base, 'ReadingTime');
  assert.equal(values.Label, 'Reading time component');
  assert.equal(values.Wrapped, 'Value: ReadingTime — Reading time component');
});

test('applies a transform after resolving a complete custom value', () => {
  const custom = resolveCustomPlaceholders(
    { DisplayName: { value: '[[FolderName]]' } },
    { FolderName: 'reading-time' },
    {},
    ['DisplayName']
  );
  assert.equal(
    replacePlaceholders('[[Custom:DisplayName>TitleCase]]', { Custom: custom }, 'name.txt'),
    'Reading Time'
  );
});

test('rejects undefined custom and prompt references', () => {
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    placeholders: { First: { value: '[[Custom:Missing]]' } }
  }, 'Invalid'), /undefined custom/u);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    placeholders: { First: { value: '[[Prompt:Missing]]' } }
  }, 'Invalid'), /undefined prompt/u);
});

test('rejects direct and multi-item custom cycles with the chain', () => {
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    placeholders: { First: { value: '[[Custom:First]]' } }
  }, 'Cycle'), /First → First/u);
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    placeholders: {
      First: { value: '[[Custom:Second]]' },
      Second: { value: '[[Custom:Third]]' },
      Third: { value: '[[Custom:First]]' }
    }
  }, 'Cycle'), /First → Second → Third → First/u);
});

test('collects prompts once in manifest order through custom dependencies', () => {
  const manifest = {
    placeholders: {
      Label: { value: '[[Prompt:Second]] / [[Prompt:First]]' }
    },
    prompts: [
      { key: 'First' },
      { key: 'Unused' },
      { key: 'Second' }
    ]
  };
  const inspected = [{
    relativePath: 'file.txt',
    placeholderMatches: [
      ...scanPlaceholders('[[Custom:Label]] [[Prompt:Second]] [[Prompt:Second]]', 'file.txt')
    ]
  }];
  const dependencies = createPromptDependencies(inspected, manifest);
  assert.deepEqual(dependencies.prompts.map((prompt) => prompt.key), ['First', 'Second']);
  assert.deepEqual(dependencies.customKeys, ['Label']);
});

test('rejects a custom and prompt that share the same key', () => {
  assert.throws(() => validateBlueprintManifest({
    version: 1,
    placeholders: { Name: { value: 'value' } },
    prompts: [{ key: 'Name', type: 'input' }]
  }, 'Duplicate'), /used by both/u);
});
