'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');
const { alignAssignments, alignPhpOperators } = require('../src/formatters/alignAssignments');
const {
  addFunctionsDependency,
  addModuleRegistration,
  buildUsefulGroupPhpRegistryUpdates
} = require('../src/integrations/usefulGroupPhpRegistry');
const { executeForgePlan } = require('../src/forge/executeForgePlan');

const fsp = fs.promises;

const usefulGroupSource = `<?php
final class Useful_Group {
    public $theme;
    public $long_module;

    public function __construct() {
        $this->autoloader = new Autoloader();

        $this->theme = new Includes\\Theme();
        $this->long_module    = new Includes\\LongModule();

        $this->modules = [
            $this->theme,
            $this->long_module
        ];
    }

    private function load_dependencies() {
        require_once USEFUL_GROUP_THEME_DIR . 'includes/theme/functions.php';
    }
}
`;

test('aligns consecutive generated parent-module assignments', () => {
  const formatted = alignAssignments(`        $this->setup = new Posts\\Setup();
        $this->helper = new Posts\\Helper();
        $this->template_data = new Posts\\Template_Data();`);
  const equalsColumns = formatted.split('\n').map((line) => line.indexOf('='));
  assert(equalsColumns.every((column) => column === equalsColumns[0]));
});

test('aligns PHP variable assignments and associative-array arrows independently', () => {
  const formatted = alignPhpOperators(`    $id = get_block_id($block);
    $custom_class = get_block_class($block);
    $title = get_block_field( 'title', $block );

    'id' => $id,
    'class' => $custom_class,
    'title' => $title,`);
  const groups = formatted.split('\n\n').map((group) => group.split('\n'));
  for (const lines of groups) {
    const operator = lines[0].includes('=>') ? '=>' : '=';
    const columns = lines.map((line) => line.indexOf(operator));
    assert(columns.every((column) => column === columns[0]));
  }
});

test('adds an idempotent useful-group module registration with aligned assignments', () => {
  const updated = addModuleRegistration(usefulGroupSource, 'book_items', 'BookItems');
  assert(updated.includes('public $book_items;'));
  assert(updated.includes('$this->book_items'));
  assert(updated.includes('new Includes\\BookItems();'));
  const assignments = updated.split('\n').filter((line) => /new Includes\\/u.test(line));
  const equalsColumns = assignments.map((line) => line.indexOf('='));
  assert(equalsColumns.every((column) => column === equalsColumns[0]));
  assert.equal(addModuleRegistration(updated, 'book_items', 'BookItems'), updated);
});

test('adds an idempotent useful-group functions dependency', () => {
  const updated = addFunctionsDependency(usefulGroupSource, 'includes/book-items/functions.php');
  assert(updated.includes("require_once USEFUL_GROUP_THEME_DIR . 'includes/book-items/functions.php';"));
  assert.equal(addFunctionsDependency(updated, 'includes/book-items/functions.php'), updated);
});

test('builds and executes a guarded useful-group workspace update', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-useful-group-'));
  try {
    const usefulGroup = path.join(root, 'useful-group');
    const includes = path.join(usefulGroup, 'includes');
    const target = path.join(includes, 'book-items');
    await fsp.mkdir(target, { recursive: true });
    const functionsPath = path.join(usefulGroup, 'functions.php');
    await fsp.writeFile(functionsPath, usefulGroupSource);
    const parentOutput = path.join(includes, 'class-book-items.php');
    const functionsOutput = path.join(target, 'functions.php');
    const plan = {
      targetDirectory: target,
      directories: [],
      files: [
        {
          sourceRelativePath: 'class-[[Prompt:ModuleName>KebabCase]].php',
          destinationPath: parentOutput,
          exists: false,
          contents: Buffer.from('parent')
        },
        {
          sourceRelativePath: 'functions.php',
          destinationPath: functionsOutput,
          exists: false,
          contents: Buffer.from('functions')
        }
      ]
    };
    const updates = await buildUsefulGroupPhpRegistryUpdates({
      vscode: { workspace: { findFiles: async () => [{ scheme: 'file', fsPath: functionsPath }] } },
      manifest: {
        workspaceEdits: [{
          type: 'usefulGroupPhpRegistry', moduleNamePrompt: 'ModuleName',
          parentModuleOption: 'parentModule', functionsOption: 'functions'
        }],
        fileSelection: { options: [
          { key: 'parentModule', files: ['class-[[Prompt:ModuleName>KebabCase]].php'] },
          { key: 'functions', files: ['functions.php'] }
        ] }
      },
      context: {
        Prompt: { ModuleName: 'Book Items' },
        Output: { parentModule: true, functions: true }
      },
      plan,
      workspaceDirectories: [root]
    });
    assert.equal(updates.length, 1);
    plan.workspaceUpdates = updates;
    const result = await executeForgePlan(plan, 'overwrite');
    assert.equal(result.workspaceFilesUpdated, 1);
    const updated = await fsp.readFile(functionsPath, 'utf8');
    assert(updated.includes('public $book_items;'));
    assert(updated.includes("'includes/book-items/functions.php'"));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('aborts before forging when a workspace update changes after preflight', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-workspace-state-'));
  try {
    const target = path.join(root, 'target');
    await fsp.mkdir(target);
    const workspaceFile = path.join(root, 'functions.php');
    await fsp.writeFile(workspaceFile, 'original');
    const output = path.join(target, 'output.txt');
    const plan = {
      targetDirectory: target,
      directories: [],
      files: [{ destinationPath: output, exists: false, contents: Buffer.from('output') }],
      workspaceUpdates: [{
        destinationPath: workspaceFile,
        originalContents: Buffer.from('original'),
        contents: Buffer.from('updated')
      }]
    };
    await fsp.writeFile(workspaceFile, 'changed');
    await assert.rejects(executeForgePlan(plan, 'overwrite'), /contents changed after validation/u);
    await assert.rejects(fsp.access(output), /ENOENT/u);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
