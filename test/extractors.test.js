'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ExtractorRegistry } = require('../src/extractors/extractorRegistry');
const { javascriptPropsExtractor } = require('../src/extractors/javascriptPropsExtractor');
const { loadCustomExtractors } = require('../src/extractors/loadCustomExtractors');
const { loadExtractorPresets } = require('../src/extractors/loadExtractorPresets');
const { regexExtractor } = require('../src/extractors/regexExtractor');
const { wordpressPropsExtractor } = require('../src/extractors/wordpressPropsExtractor');
const { validateExtractorResult } = require('../src/extractors/validateExtractorResult');
const { test } = require('./harness');

const fsp = fs.promises;

test('regex extractor returns named and unnamed captures in source order and adds global matching', async () => {
  const named = await regexExtractor({ content: '--one: red; --two: blue;', options: {
    pattern: '--(?<name>[a-z]+):\\s*(?<value>[^;]+);', flags: 'm'
  } });
  assert.deepStrictEqual(named, [
    { match: '--one: red;', matchIndex: 0, name: 'one', value: 'red' },
    { match: '--two: blue;', matchIndex: 12, name: 'two', value: 'blue' }
  ]);
  const unnamed = await regexExtractor({ content: 'a=1 b=', options: { pattern: '([a-z])=(\\d)?' } });
  assert.deepStrictEqual(unnamed[1], { match: 'b=', matchIndex: 4, group1: 'b', group2: '' });
});

test('regex extractor rejects invalid expressions, flags, and reserved capture fields', async () => {
  await assert.rejects(regexExtractor({ content: '', options: { pattern: '(' } }), /Invalid regular expression/);
  await assert.rejects(regexExtractor({ content: '', options: { pattern: '.', flags: 'gg' } }), /flags/);
  await assert.rejects(regexExtractor({ content: 'x', options: { pattern: '(?<match>x)' } }), /reserved/);
});

test('regex extractor advances safely after zero-length matches', async () => {
  const records = await regexExtractor({ content: 'ab', options: { pattern: '(?=.)' } });
  assert.deepStrictEqual(records.map((record) => record.matchIndex), [0, 1]);
});

test('regex extractor can deduplicate records by a captured field', async () => {
  const records = await regexExtractor({
    content: 'prop:title prop:url prop:title',
    options: { pattern: 'prop:(?<name>[a-z]+)', uniqueBy: 'name' }
  });
  assert.deepEqual(records.map((record) => record.name), ['title', 'url']);
  await assert.rejects(regexExtractor({
    content: 'prop:title', options: { pattern: 'prop:(?<name>[a-z]+)', uniqueBy: 'missing' }
  }), /is missing/);
});

test('WordPress props extractor reads every admit_props entry including a final entry without a comma', async () => {
  const records = await wordpressPropsExtractor({ content: `<?php
    $props->admit_props([
        'title',
        // Optional supporting copy.
        'description'
    ]);

    $class = $props->class([
        'm-test'
    ]);
  ` });
  assert.deepStrictEqual(records, [{ name: 'title' }, { name: 'description' }]);
});

test('JavaScript props extractor handles destructuring, aliases, defaults, and rest', async () => {
  const content = 'const Card = ({ title, image: featuredImage, enabled = false, ...rest }) => null; export default Card;';
  const withoutRest = await javascriptPropsExtractor({ content, filePath: '/tmp/Card.jsx' });
  assert.deepStrictEqual(withoutRest.map((item) => item.name), ['title', 'image', 'enabled']);
  assert.deepStrictEqual(withoutRest[1], {
    name: 'image', localName: 'featuredImage', hasDefault: false, defaultValue: '', isRest: false, sourceOrder: 1
  });
  assert.strictEqual(withoutRest[2].defaultValue, 'false');
  const withRest = await javascriptPropsExtractor({ content, filePath: '/tmp/Card.jsx', options: { includeRest: true } });
  assert.strictEqual(withRest[3].isRest, true);
});

test('JavaScript props extractor handles functions, member access, computed strings, JSX, TS, and TSX', async () => {
  const js = 'export default function Card(props) { return <div>{props.title}{props.title}{props[\'image\']}{props[key]}</div>; }';
  assert.deepStrictEqual((await javascriptPropsExtractor({ content: js, filePath: '/tmp/Card.jsx' })).map((item) => item.name), ['title', 'image']);
  const ts = 'function Card({ title, count = 2 }: { title: string; count?: number }) { return null; } export default Card;';
  assert.deepStrictEqual((await javascriptPropsExtractor({ content: ts, filePath: '/tmp/Card.ts' })).map((item) => item.name), ['title', 'count']);
  const tsx = 'export const Card = ({ title }: { title: string }) => <div>{title}</div>;';
  assert.deepStrictEqual((await javascriptPropsExtractor({ content: tsx, filePath: '/tmp/Card.tsx', options: { component: 'Card' } })).map((item) => item.name), ['title']);
});

test('JavaScript props extractor reports missing components and parse failures', async () => {
  await assert.rejects(javascriptPropsExtractor({ content: 'const Card = () => null;', filePath: '/tmp/Card.js' }), /Could not find component/);
  await assert.rejects(javascriptPropsExtractor({ content: 'const =', filePath: '/tmp/Card.js', options: { component: 'Card' } }), /Could not parse/);
});

test('extractor presets register valid entries independently and merge blueprint options', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-presets-'));
  try {
    const file = path.join(root, 'extractors.json');
    await fsp.writeFile(file, JSON.stringify({ version: 1, extractors: {
      'user.words': { extends: 'fileFoundry.regex', options: { pattern: '(?<name>[a-z]+)', flags: 'i' } },
      'fileFoundry.bad': { extends: 'fileFoundry.regex', options: { pattern: '.' } },
      'user.missing': { extends: 'missing.base' }
    } }));
    const registry = new ExtractorRegistry();
    const loaded = await loadExtractorPresets(file, registry);
    assert.deepStrictEqual(loaded.loaded, ['user.words']);
    assert.strictEqual(loaded.failures.length, 2);
    const result = await registry.get('user.words').extract({ content: 'ONE two', options: { flags: 'g' } });
    assert.deepStrictEqual(result.map((record) => record.name), ['two']);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('extractor preset files require version 1 and reject duplicate JSON keys', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-presets-invalid-'));
  try {
    const file = path.join(root, 'extractors.json');
    await fsp.writeFile(file, '{"version":2,"extractors":{}}');
    assert((await loadExtractorPresets(file, new ExtractorRegistry())).failures[0].includes('version 1'));
    await fsp.writeFile(file, '{"version":1,"version":1,"extractors":{}}');
    assert((await loadExtractorPresets(file, new ExtractorRegistry())).failures[0].includes('duplicate'));
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('custom extractors load independently, validate contracts, and stay disabled when untrusted', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-custom-extractors-'));
  try {
    await fsp.writeFile(path.join(root, 'good.cjs'), "module.exports={id:'user.good',name:'Good',apiVersion:1,extract:async()=>[{name:'ok'}]};");
    await fsp.writeFile(path.join(root, 'bad.js'), "module.exports={id:'user.bad',name:'Bad',apiVersion:2,extract(){return []}};");
    const registry = new ExtractorRegistry();
    const loaded = await loadCustomExtractors(root, registry, { trusted: true });
    assert.deepStrictEqual(loaded.loaded, ['user.good']);
    assert.strictEqual(loaded.failures.length, 1);
    const untrusted = await loadCustomExtractors(root, new ExtractorRegistry(), { trusted: false });
    assert.deepStrictEqual(untrusted.loaded, []);
    assert(untrusted.failures[0].includes('untrusted'));
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('extractor return validation accepts scalar records and rejects unsafe shapes', () => {
  assert.deepStrictEqual(validateExtractorResult([{ text: 'x', count: 2, enabled: true, empty: null }], 'user.test')[0], {
    text: 'x', count: 2, enabled: true, empty: null
  });
  assert.throws(() => validateExtractorResult({}, 'user.test'), /array/);
  assert.throws(() => validateExtractorResult([new Date()], 'user.test'), /plain object/);
  assert.throws(() => validateExtractorResult([{ nested: {} }], 'user.test'), /invalid field/);
  assert.throws(() => validateExtractorResult([{ run() {} }], 'user.test'), /invalid field/);
});
