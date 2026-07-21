'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');
const { collectPromptValues } = require('../src/prompts/collectPromptValues');
const { promptConfirm } = require('../src/prompts/promptConfirm');
const { promptInput } = require('../src/prompts/promptInput');
const { promptMultiPick } = require('../src/prompts/promptMultiPick');
const { formatSelectedPath, promptPath } = require('../src/prompts/promptPath');
const { promptPick } = require('../src/prompts/promptPick');
const { replacePlaceholders } = require('../src/placeholders/replacePlaceholders');

const fsp = fs.promises;

test('input prompts resolve built-in defaults and expose validation and password mode', async () => {
  let received;
  const vscode = {
    window: {
      showInputBox: async (options) => {
        received = options;
        assert.equal(options.validateInput('  '), 'Display name is required.');
        assert.equal(options.validateInput('123'), 'Start with a letter.');
        assert.equal(options.validateInput('Reading Time'), undefined);
        return 'Reading Time';
      }
    }
  };
  const result = await promptInput(vscode, {
    key: 'DisplayName',
    type: 'input',
    title: 'Display name',
    default: '[[FolderName>TitleCase]]',
    required: true,
    password: true,
    validation: { pattern: '^[A-Za-z]', message: 'Start with a letter.' }
  }, { FolderName: 'reading-time' });
  assert.equal(result, 'Reading Time');
  assert.equal(received.value, 'Reading Time');
  assert.equal(received.password, true);
});

test('input prompts resolve a useful-group PHP namespace and otherwise fall back to prompting', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-namespace-'));
  try {
    const usefulGroup = path.join(root, 'useful-group');
    const target = path.join(usefulGroup, 'includes');
    await fsp.mkdir(target, { recursive: true });
    const functionsPath = path.join(usefulGroup, 'functions.php');
    await fsp.writeFile(functionsPath, '<?php\n\nnamespace Useful_Group;\n');
    let promptCalls = 0;
    const definition = {
      key: 'ProjectNamespace', type: 'input', title: 'Project PHP namespace',
      autoValue: { type: 'usefulGroupPhpNamespace' }
    };
    const vscode = {
      workspace: { findFiles: async () => [{ scheme: 'file', fsPath: functionsPath }] },
      window: { showInputBox: async () => { promptCalls += 1; return 'Fallback_Namespace'; } }
    };
    assert.equal(await promptInput(vscode, definition, {}, {
      targetDirectory: target, workspaceDirectories: [root]
    }), 'Useful_Group');
    assert.equal(promptCalls, 0);

    vscode.workspace.findFiles = async () => [];
    assert.equal(await promptInput(vscode, definition, {}, {
      targetDirectory: path.join(root, 'elsewhere'), workspaceDirectories: [root]
    }), 'Fallback_Namespace');
    assert.equal(promptCalls, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('pick prompts preserve UI metadata while returning replacement values', async () => {
  let received;
  const vscode = {
    window: {
      showQuickPick: async (items) => {
        received = items;
        return items[1];
      }
    }
  };
  const result = await promptPick(vscode, {
    key: 'Language',
    options: [
      { label: 'JavaScript', value: 'js', description: 'JS files', detail: 'Plain JavaScript' },
      { label: 'TypeScript', value: 'ts', description: 'TS files', detail: 'Typed files' }
    ],
    default: 'js'
  });
  assert.equal(result, 'ts');
  assert.equal(received[0].picked, true);
  assert.equal(received[0].description, 'JS files');
  assert.equal(received[0].detail, 'Plain JavaScript');
});

test('pick prompts resolve theme-aware icons relative to blueprint metadata', async () => {
  let received;
  const vscode = {
    Uri: { file: (value) => ({ fsPath: value }) },
    window: { showQuickPick: async (items) => { received = items; return items[0]; } }
  };
  const blueprintDirectory = path.join(path.sep, 'blueprints', 'Post Type');
  const result = await promptPick(vscode, {
    key: 'Icon',
    options: [{
      label: 'Book', value: 'dashicons-book',
      iconPath: { light: '.file-foundry/dark/book.svg', dark: '.file-foundry/light/book.svg' }
    }]
  }, { blueprintDirectory });
  assert.equal(result, 'dashicons-book');
  assert.equal(received[0].iconPath.light.fsPath, path.join(blueprintDirectory, '.file-foundry/dark/book.svg'));
  assert.equal(received[0].iconPath.dark.fsPath, path.join(blueprintDirectory, '.file-foundry/light/book.svg'));
});

test('multi-pick prompts join defaults with a custom separator', async () => {
  const vscode = {
    window: {
      showQuickPick: async (items) => items.filter((item) => item.picked),
      showWarningMessage: async () => undefined
    }
  };
  const result = await promptMultiPick(vscode, {
    key: 'Keywords',
    options: [
      { label: 'Accessible', value: 'accessible' },
      { label: 'Responsive', value: 'responsive' },
      { label: 'Interactive', value: 'interactive' }
    ],
    default: ['accessible', 'responsive'],
    separator: ' | ',
    required: false
  });
  assert.equal(result, 'accessible | responsive');
});

test('multi-pick supports an empty optional selection and enforces required selection', async () => {
  const optionalVscode = { window: { showQuickPick: async () => [], showWarningMessage: async () => undefined } };
  assert.equal(await promptMultiPick(optionalVscode, {
    key: 'Optional', options: [], separator: ', ', required: false
  }), '');

  let calls = 0;
  const requiredVscode = {
    window: {
      showQuickPick: async (items) => {
        calls += 1;
        return calls === 1 ? [] : [items[0]];
      },
      showWarningMessage: async () => undefined
    }
  };
  assert.equal(await promptMultiPick(requiredVscode, {
    key: 'Required', options: [{ label: 'One', value: 'one' }], separator: ', ', required: true
  }), 'one');
  assert.equal(calls, 2);
});

test('confirm prompts support true/false defaults, custom labels, and values', async () => {
  let items;
  const vscode = { window: { showQuickPick: async (presented) => {
    items = presented;
    return presented.find((item) => item.value === 'excluded');
  } } };
  const result = await promptConfirm(vscode, {
    trueLabel: 'Include it',
    falseLabel: 'Leave it out',
    trueValue: 'included',
    falseValue: 'excluded',
    default: false
  });
  assert.equal(result, 'excluded');
  assert.equal(items[0].label, 'Leave it out');
  assert.equal(items[0].picked, true);
});

test('formats file and folder prompt paths in every supported form', () => {
  const workspace = path.join(path.sep, 'workspace');
  const target = path.join(workspace, 'components', 'thing');
  const selected = path.join(workspace, 'assets', 'icon.svg');
  const context = { targetDirectory: target, workspaceDirectories: [workspace] };
  assert.equal(formatSelectedPath(selected, 'absolute', context), selected);
  assert.equal(formatSelectedPath(selected, 'workspaceRelative', context), path.join('assets', 'icon.svg'));
  assert.equal(formatSelectedPath(selected, 'targetRelative', context), path.join('..', '..', 'assets', 'icon.svg'));
  assert.equal(formatSelectedPath(selected, 'basename', context), 'icon.svg');
  assert.throws(() => formatSelectedPath('/outside/file.js', 'workspaceRelative', context), /outside every open workspace/u);
});

test('file and folder prompts configure native dialogs and support cancellation', async () => {
  const calls = [];
  const vscode = {
    window: {
      showOpenDialog: async (options) => {
        calls.push(options);
        return calls.length === 1 ? [{ scheme: 'file', fsPath: '/workspace/file.js' }] : undefined;
      }
    }
  };
  const context = {
    targetDirectory: '/workspace/target',
    targetUri: { scheme: 'file', fsPath: '/workspace/target' },
    workspaceDirectories: ['/workspace']
  };
  assert.equal(await promptPath(vscode, {
    key: 'File', type: 'file', pathFormat: 'basename', filters: { JavaScript: ['js'] }
  }, context), 'file.js');
  assert.equal(await promptPath(vscode, {
    key: 'Folder', type: 'folder', pathFormat: 'absolute'
  }, context), undefined);
  assert.equal(calls[0].canSelectFiles, true);
  assert.equal(calls[1].canSelectFolders, true);
});

test('prompt collection follows provided order, prompts once, and cancels cleanly', async () => {
  const seen = [];
  const vscode = {
    window: {
      showInputBox: async (options) => {
        seen.push(options.title);
        return options.title === 'Cancel' ? undefined : options.title;
      }
    }
  };
  const values = await collectPromptValues(vscode, [
    { key: 'First', type: 'input', title: 'First', required: false, password: false },
    { key: 'Second', type: 'input', title: 'Second', required: false, password: false }
  ], {}, {});
  assert.deepEqual(seen, ['First', 'Second']);
  assert.deepEqual(values, { First: 'First', Second: 'Second' });

  const canceled = await collectPromptValues(vscode, [
    { key: 'Cancel', type: 'input', title: 'Cancel', required: false, password: false },
    { key: 'Never', type: 'input', title: 'Never', required: false, password: false }
  ], {}, {});
  assert.equal(canceled, undefined);
  assert.equal(seen.includes('Never'), false);
});

test('prompt transforms apply independently after collecting one original answer', () => {
  const context = { Prompt: { Name: 'reading time' } };
  assert.equal(
    replacePlaceholders('[[Prompt:Name>PascalCase]]/[[Prompt:Name>KebabCase]]', context, 'output.txt'),
    'ReadingTime/reading-time'
  );
});
