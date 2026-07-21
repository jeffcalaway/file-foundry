'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { test } = require('./harness');
const {
  COLLECTION_SCOPES,
  COLLECTION_TYPES,
  EMPTY_BEHAVIORS,
  PATH_FORMATS,
  PROMPT_TYPES,
  TOP_LEVEL_PROPERTIES
} = require('../src/manifests/manifestConstants');
const { TRANSFORMS } = require('../src/placeholders/transforms');

const root = path.resolve(__dirname, '..');
const readmePath = path.join(root, 'README.md');

test('README documents every public blueprint feature family', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  const expected = [
    ...TOP_LEVEL_PROPERTIES,
    ...PROMPT_TYPES,
    ...COLLECTION_TYPES,
    ...COLLECTION_SCOPES,
    ...EMPTY_BEHAVIORS,
    ...PATH_FORMATS,
    ...Object.keys(TRANSFORMS),
    'initialRecords', 'onMissing', 'uniqueBy',
    'fileFoundry.regex', 'fileFoundry.wordpressProps', 'fileFoundry.javascriptProps',
    'alignAssignments', 'alignPhpOperators', 'usefulGroupPhpRegistry', 'wordpressTemplateBlock',
    'mostSelectedBlueprints', 'Most Selected',
    '[[#each', '[[#if', '[[#elseif', '[[#else', 'contains', 'Output:'
  ];
  for (const feature of expected) {
    assert(readme.includes(feature), `README is missing public feature ${feature}.`);
  }
});

test('README contents links and organized visual assets resolve', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  const headings = new Set(readme.split(/\r?\n/u)
    .filter((line) => /^#{1,6}\s/u.test(line))
    .map((line) => githubSlug(line.replace(/^#{1,6}\s+/u, ''))));
  for (const match of readme.matchAll(/\]\(#([^)]+)\)/gu)) {
    assert(headings.has(match[1]), `README link target #${match[1]} does not exist.`);
  }
  const images = [...readme.matchAll(/<img[^>]+src="([^"]+)"/gu)].map((match) => match[1]);
  assert(images.length >= 3, 'README should keep a small set of useful visuals.');
  for (const image of images) {
    assert(image.startsWith('docs/assets/readme/'), `README image is outside the organized asset root: ${image}.`);
    assert(fs.existsSync(path.join(root, image)), `README image does not exist: ${image}.`);
  }
  assert.equal((readme.match(/^```/gmu) || []).length % 2, 0, 'README code fences are unbalanced.');
});

function githubSlug(value) {
  return value.toLowerCase()
    .replace(/<[^>]*>/gu, '')
    .replace(/[.*_{}()#+!]/gu, '')
    .split('`').join('')
    .split('[').join('')
    .split(']').join('')
    .trim()
    .replace(/\s+/gu, '-');
}
