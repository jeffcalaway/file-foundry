'use strict';

const assert = require('assert').strict;
const path = require('path');
const { test } = require('./harness');
const { createContext } = require('../src/placeholders/createContext');
const { parsePlaceholder } = require('../src/placeholders/parsePlaceholder');
const { replacePlaceholders } = require('../src/placeholders/replacePlaceholders');
const { TRANSFORMS } = require('../src/placeholders/transforms');

test('creates all context placeholders from target and parent names', () => {
  const context = createContext(path.join(path.sep, 'components', 'molecules', 'reading-time'));
  assert.deepEqual(context, {
    FolderName: 'reading-time',
    FolderLetter: 'r',
    DirName: 'molecules',
    DirLetter: 'm'
  });
});

for (const folderName of ['Reading Time', 'reading-time', 'reading_time']) {
  test(`preserves target folder spelling in context: ${folderName}`, () => {
    const context = createContext(path.join(path.sep, 'components', 'models', folderName));
    assert.equal(context.FolderName, folderName);
    assert.equal(context.FolderLetter, 'R'.toLowerCase() === folderName[0] ? 'r' : folderName[0]);
    assert.equal(context.DirName, 'models');
    assert.equal(context.DirLetter, 'm');
  });
}

const transformCases = {
  'menu-link': ['menu', 'link'],
  'Menu Link': ['menu', 'link'],
  menuLink: ['menu', 'link'],
  MenuLink: ['menu', 'link'],
  menu_link: ['menu', 'link'],
  HTMLParser: ['html', 'parser'],
  'version2-item': ['version2', 'item']
};

const expectedForWords = {
  UpperCase: (words) => words.join(' ').toUpperCase(),
  LowerCase: (words) => words.join(' '),
  SentenceCase: (words) => capitalize(words.join(' ')),
  TitleCase: (words) => words.map(capitalize).join(' '),
  SingularTitleCase: (words) => words.map(capitalize).join(' '),
  CamelCase: (words) => words[0] + words.slice(1).map(capitalize).join(''),
  PascalCase: (words) => words.map(capitalize).join(''),
  SnakeCase: (words) => words.join('_'),
  UpperSnakeCase: (words) => words.join('_').toUpperCase(),
  KebabCase: (words) => words.join('-'),
  TrainCase: (words) => words.map(capitalize).join('-'),
  FlatCase: (words) => words.join('')
};

for (const [value, words] of Object.entries(transformCases)) {
  for (const [name, transform] of Object.entries(TRANSFORMS)) {
    test(`${name} transforms ${value}`, () => {
      assert.equal(transform(value), expectedForWords[name](words));
    });
  }
}

test('SingularTitleCase creates concise labels for plural collection folders', () => {
  assert.equal(TRANSFORMS.SingularTitleCase('archetypes'), 'Archetype');
  assert.equal(TRANSFORMS.SingularTitleCase('atoms'), 'Atom');
  assert.equal(TRANSFORMS.SingularTitleCase('categories'), 'Category');
  assert.equal(TRANSFORMS.SingularTitleCase('classes'), 'Class');
});

test('parses supported placeholder forms', () => {
  assert.deepEqual(parsePlaceholder('[[FolderName]]'), {
    namespace: 'BuiltIn',
    key: 'FolderName',
    placeholder: 'FolderName',
    transform: undefined,
    expression: '[[FolderName]]'
  });
  assert.equal(parsePlaceholder('[[FolderName>PascalCase]]').transform, 'PascalCase');
  assert.equal(parsePlaceholder('[[DirLetter>LowerCase]]').placeholder, 'DirLetter');
});

for (const invalid of [
  '[[UnknownName]]',
  '[[FolderName>KababCase]]',
  '[[FolderName>UnknownTransform]]',
  '[[FolderName>LowerCase>PascalCase]]',
  '[[FolderName>]]',
  '[FolderName]'
]) {
  test(`rejects invalid placeholder expression: ${invalid}`, () => {
    assert.throws(() => parsePlaceholder(invalid));
  });
}

test('replaces placeholders without changing JavaScript template expressions', () => {
  const source = "const name = '[[FolderName>PascalCase]]';\nconst value = `${someValue}`;";
  const output = replacePlaceholders(source, {
    FolderName: 'reading-time',
    FolderLetter: 'r',
    DirName: 'molecules',
    DirLetter: 'm'
  }, 'component.js');

  assert.equal(output, "const name = 'ReadingTime';\nconst value = `${someValue}`;");
});

test('leaves ordinary square brackets untouched', () => {
  assert.equal(replacePlaceholders('array[index] and [FolderName]', {}, 'example.txt'), 'array[index] and [FolderName]');
});

test('reports malformed expressions with their source path', () => {
  assert.throws(
    () => replacePlaceholders('before [[FolderName>]] after', {}, 'nested/example.txt'),
    /nested\/example\.txt/
  );
});

/** @param {string} value */
function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}
