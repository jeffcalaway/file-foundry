'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');
const { isBinaryBuffer } = require('../src/filesystem/detectBinary');
const { normalizeDestination } = require('../src/filesystem/normalizeDestination');
const { resolveBlueprintDirectory } = require('../src/blueprints/resolveBlueprintDirectory');

const fsp = fs.promises;

test('detects UTF-8 text and binary buffers', () => {
  assert.equal(isBinaryBuffer(Buffer.from('Hello, 世界\n')), false);
  assert.equal(isBinaryBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])), true);
});

test('rejects output path traversal', () => {
  const target = path.join(path.sep, 'workspace', 'target');
  assert.throws(() => normalizeDestination(target, ['..', 'escaped.txt'], 'bad.txt'), /unsafe|escapes/u);
});

test('resolves workspace-relative and tilde blueprint paths', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-resolve-'));
  const blueprintRoot = path.join(root, 'blueprints');
  await fsp.mkdir(blueprintRoot);

  assert.equal(
    await resolveBlueprintDirectory('blueprints', {
      targetDirectory: path.join(root, 'target'),
      workspaceDirectories: [root]
    }),
    blueprintRoot
  );
  assert.equal(await resolveBlueprintDirectory('~'), os.homedir());
  await fsp.rm(root, { recursive: true, force: true });
});
