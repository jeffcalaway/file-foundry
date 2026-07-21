'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');
const {
  MANIFEST_READ_CONCURRENCY,
  discoverBlueprints,
  mapWithConcurrency
} = require('../src/blueprints/discoverBlueprints');
const { formatForgeTarget, openSingleCreatedFile } = require('../src/commands/forgeBlueprintHere');
const { buildForgePlan } = require('../src/forge/buildForgePlan');
const { executeForgePlan } = require('../src/forge/executeForgePlan');
const { resolveConflicts } = require('../src/forge/resolveConflicts');

const fsp = fs.promises;

test('formats forge picker targets using only the parent and folder names', () => {
  assert.equal(
    formatForgeTarget(path.join('/Users/example/project/src/components/atoms/TestComponent')),
    '/atoms/TestComponent/'
  );
  assert.equal(formatForgeTarget(path.parse(process.cwd()).root), '/');
});

test('opens the generated file only when exactly one new file was created', async () => {
  const calls = [];
  const vscode = {
    Uri: { file: (filePath) => ({ scheme: 'file', fsPath: filePath }) },
    commands: { executeCommand: async (...args) => calls.push(args) }
  };
  const plan = {
    files: [
      { destinationPath: '/target/existing.js', exists: true },
      { destinationPath: '/target/created.js', exists: false }
    ]
  };

  assert.equal(await openSingleCreatedFile(vscode, plan, { filesCreated: 1 }), true);
  assert.deepEqual(calls, [['vscode.open', { scheme: 'file', fsPath: '/target/created.js' }]]);

  calls.length = 0;
  assert.equal(await openSingleCreatedFile(vscode, plan, { filesCreated: 0 }), false);
  assert.deepEqual(calls, []);

  assert.equal(await openSingleCreatedFile(vscode, {
    files: [
      { destinationPath: '/target/one.js', exists: false },
      { destinationPath: '/target/two.js', exists: false }
    ]
  }, { filesCreated: 2 }), false);
  assert.deepEqual(calls, []);
});

test('discovers only immediate child directories as blueprints', async () => {
  await withFixture(async ({ blueprintRoot }) => {
    await fsp.mkdir(path.join(blueprintRoot, 'Alpha'));
    await fsp.mkdir(path.join(blueprintRoot, 'Beta'));
    await fsp.writeFile(path.join(blueprintRoot, 'not-a-blueprint.txt'), 'ignored');
    assert.deepEqual((await discoverBlueprints(blueprintRoot)).map((item) => item.name), ['Alpha', 'Beta']);
  });
});

test('blueprint discovery helper preserves order with bounded I/O concurrency', async () => {
  let active = 0;
  let peak = 0;
  const values = Array.from({ length: 40 }, (_, index) => index);
  const result = await mapWithConcurrency(values, MANIFEST_READ_CONCURRENCY, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, values.map((value) => value * 2));
  assert.equal(peak, MANIFEST_READ_CONCURRENCY);
});

test('sorts discovered blueprints by their displayed manifest names', async () => {
  await withFixture(async ({ blueprintRoot }) => {
    const firstDirectory = path.join(blueprintRoot, '01-last');
    const secondDirectory = path.join(blueprintRoot, '02-first');
    await Promise.all([fsp.mkdir(firstDirectory), fsp.mkdir(secondDirectory)]);
    await Promise.all([
      fsp.writeFile(path.join(firstDirectory, 'blueprint.json'), JSON.stringify({ version: 1, name: 'Zulu' })),
      fsp.writeFile(path.join(secondDirectory, 'blueprint.json'), JSON.stringify({ version: 1, name: 'Alpha' }))
    ]);
    assert.deepEqual((await discoverBlueprints(blueprintRoot)).map((item) => item.name), ['Alpha', 'Zulu']);
  });
});

test('plans nested names, multiple placeholders, empty directories, dotfiles, text, and binary files', async () => {
  await withFixture(async ({ blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Complete');
    const nested = path.join(blueprint, '[[FolderName>PascalCase]]');
    await fsp.mkdir(path.join(nested, 'empty'), { recursive: true });
    await fsp.writeFile(
      path.join(nested, '[[DirLetter>LowerCase]]-[[FolderName>KebabCase]].js'),
      "export const name = '[[FolderName>TitleCase]]';\n"
    );
    await fsp.writeFile(path.join(blueprint, '.gitignore'), 'dist/\n');
    await fsp.writeFile(path.join(blueprint, 'logo.bin'), Buffer.from([0, 1, 2, 255]));
    await fsp.writeFile(path.join(blueprint, '.DS_Store'), 'ignored');

    const plan = await buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target });
    assert.deepEqual(plan.directories.map((entry) => entry.destinationRelativePath), [
      'ReadingTime',
      path.join('ReadingTime', 'empty')
    ]);
    assert.deepEqual(plan.files.map((entry) => entry.destinationRelativePath), [
      '.gitignore',
      'logo.bin',
      path.join('ReadingTime', 'm-reading-time.js')
    ]);
    assert.equal(plan.files.find((entry) => entry.destinationRelativePath.endsWith('.js')).contents.toString(), "export const name = 'Reading Time';\n");
    assert.deepEqual(plan.files.find((entry) => entry.binary).contents, Buffer.from([0, 1, 2, 255]));
  });
});

test('detects duplicate generated paths', async () => {
  await withFixture(async ({ blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Duplicates');
    await fsp.mkdir(blueprint);
    await fsp.writeFile(path.join(blueprint, '[[FolderName]].txt'), 'one');
    await fsp.writeFile(path.join(blueprint, 'reading-time.txt'), 'two');
    await assert.rejects(
      buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target }),
      /same destination/u
    );
  });
});

test('finds all existing destination file conflicts in preflight', async () => {
  await withFixture(async ({ blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Conflicts');
    await fsp.mkdir(blueprint);
    await fsp.writeFile(path.join(blueprint, 'one.txt'), 'new one');
    await fsp.writeFile(path.join(blueprint, 'two.txt'), 'new two');
    await fsp.writeFile(path.join(target, 'one.txt'), 'old one');
    await fsp.writeFile(path.join(target, 'two.txt'), 'old two');

    const plan = await buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target });
    assert.equal(plan.conflicts.length, 2);
  });
});

test('warns once with every existing file and always selects the skip policy', async () => {
  const calls = [];
  const vscode = { window: { showWarningMessage: async (...args) => { calls.push(args); } } };
  const policy = await resolveConflicts(vscode, [
    { destinationPath: '/target/one.txt', destinationRelativePath: 'one.txt' },
    { destinationPath: '/target/nested/two.txt', destinationRelativePath: path.join('nested', 'two.txt') }
  ]);
  assert.equal(policy, 'skip');
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /2 files.*already exist/u);
  assert.deepEqual(calls[0][1], {
    modal: true,
    detail: '• one.txt\n• nested/two.txt'
  });

  calls.length = 0;
  assert.equal(await resolveConflicts(vscode, []), 'skip');
  assert.equal(calls.length, 0);
});

test('skipped existing files do not require their content prompts to resolve', async () => {
  await withFixture(async ({ blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Existing Prompt Output');
    await fsp.mkdir(blueprint);
    await fsp.writeFile(path.join(blueprint, 'story.php'), '[[Prompt:StoryProps]]');
    await fsp.writeFile(path.join(target, 'story.php'), 'preserved');

    const plan = await buildForgePlan({
      blueprintDirectory: blueprint,
      targetDirectory: target,
      context: { FolderName: 'reading-time', FolderLetter: 'r', DirName: 'molecules', DirLetter: 'm' },
      skipExistingFiles: true
    });
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.files[0].contents.length, 0);
    await executeForgePlan(plan, 'skip');
    assert.equal(await fsp.readFile(path.join(target, 'story.php'), 'utf8'), 'preserved');
  });
});

test('waits for the existing-file alert before creating non-conflicting files', async () => {
  await withFixture(async ({ blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Warning Order');
    await fsp.mkdir(blueprint);
    await fsp.writeFile(path.join(blueprint, 'existing.txt'), 'replacement');
    await fsp.writeFile(path.join(blueprint, 'new.txt'), 'created');
    await fsp.writeFile(path.join(target, 'existing.txt'), 'preserved');
    const plan = await buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target });
    let warned = false;
    const vscode = { window: { showWarningMessage: async () => {
      warned = true;
      await assert.rejects(fsp.access(path.join(target, 'new.txt')), /ENOENT/u);
      assert.equal(await fsp.readFile(path.join(target, 'existing.txt'), 'utf8'), 'preserved');
    } } };
    await resolveConflicts(vscode, plan.conflicts);
    assert.equal(warned, true);
    const result = await executeForgePlan(plan, 'skip');
    assert.equal(await fsp.readFile(path.join(target, 'new.txt'), 'utf8'), 'created');
    assert.equal(result.filesCreated, 1);
    assert.equal(result.filesSkipped, 1);
  });
});

test('unknown placeholders fail before any output is written', async () => {
  await withFixture(async ({ blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Invalid');
    await fsp.mkdir(blueprint);
    await fsp.writeFile(path.join(blueprint, 'valid.txt'), 'valid');
    await fsp.writeFile(path.join(blueprint, 'invalid.txt'), '[[UnknownName]]');

    await assert.rejects(
      buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target }),
      /Unknown placeholder/u
    );
    assert.deepEqual(await fsp.readdir(target), []);
  });
});

test('rejects blueprint symlinks', async () => {
  await withFixture(async ({ root, blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Symlink');
    await fsp.mkdir(blueprint);
    const external = path.join(root, 'external.txt');
    await fsp.writeFile(external, 'external');
    await fsp.symlink(external, path.join(blueprint, 'link.txt'));

    await assert.rejects(
      buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target }),
      /Symbolic links are unsupported/u
    );
  });
});

test('executes create, overwrite, and skip policies', async () => {
  await withFixture(async ({ blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Execute');
    await fsp.mkdir(path.join(blueprint, 'empty'), { recursive: true });
    await fsp.writeFile(path.join(blueprint, 'existing.txt'), 'replacement');
    await fsp.writeFile(path.join(blueprint, 'new.txt'), 'created');
    await fsp.writeFile(path.join(target, 'existing.txt'), 'original');

    const skipPlan = await buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target });
    const skipped = await executeForgePlan(skipPlan, 'skip');
    assert.deepEqual(skipped, {
      filesCreated: 1,
      foldersCreated: 1,
      filesSkipped: 1,
      filesOverwritten: 0,
      workspaceFilesUpdated: 0
    });
    assert.equal(await fsp.readFile(path.join(target, 'existing.txt'), 'utf8'), 'original');

    const overwritePlan = await buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target });
    const overwritten = await executeForgePlan(overwritePlan, 'overwrite');
    assert.equal(overwritten.filesOverwritten, 2);
    assert.equal(await fsp.readFile(path.join(target, 'existing.txt'), 'utf8'), 'replacement');
  });
});

test('aborts before writing when destination state changes after preflight', async () => {
  await withFixture(async ({ blueprintRoot, target }) => {
    const blueprint = path.join(blueprintRoot, 'Changed');
    await fsp.mkdir(blueprint);
    await fsp.writeFile(path.join(blueprint, 'a-existing.txt'), 'replacement');
    await fsp.writeFile(path.join(blueprint, 'z-new.txt'), 'planned');
    await fsp.writeFile(path.join(target, 'a-existing.txt'), 'original');

    const plan = await buildForgePlan({ blueprintDirectory: blueprint, targetDirectory: target });
    await fsp.writeFile(path.join(target, 'z-new.txt'), 'appeared later');

    await assert.rejects(executeForgePlan(plan, 'overwrite'), /state changed/u);
    assert.equal(await fsp.readFile(path.join(target, 'a-existing.txt'), 'utf8'), 'original');
  });
});

/**
 * @param {(fixture: {root: string, blueprintRoot: string, target: string}) => Promise<void>} callback
 */
async function withFixture(callback) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-test-'));
  const blueprintRoot = path.join(root, 'blueprints');
  const target = path.join(root, 'components', 'molecules', 'reading-time');
  await fsp.mkdir(blueprintRoot, { recursive: true });
  await fsp.mkdir(target, { recursive: true });

  try {
    await callback({ root, blueprintRoot, target });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}
