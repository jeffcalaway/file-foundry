'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildForgePlan } = require('../src/forge/buildForgePlan');
const { inspectSelectedSources } = require('../src/forge/inspectSelectedSources');
const { resolveRequiredForgeInputs } = require('../src/forge/resolveRequiredForgeInputs');
const { normalizeBlueprintManifest } = require('../src/manifests/normalizeBlueprintManifest');
const { analyzeTemplateDependencies } = require('../src/templates/analyzeTemplateDependencies');
const { parseTemplate } = require('../src/templates/parseTemplate');
const { renderTemplate } = require('../src/templates/renderTemplate');
const { test } = require('./harness');

const fsp = fs.promises;

function values(overrides = {}) {
  return {
    builtIns: { FolderName: 'reading-time', FolderLetter: 'r', DirName: 'molecules', DirLetter: 'm' },
    prompts: {}, rawPrompts: {}, collections: {}, custom: {},
    promptDefinitions: {}, collectionDefinitions: {}, customDefinitions: {}, outputs: {}, outputDefinitions: {},
    ...overrides
  };
}

test('conditional templates can branch on selected output options', () => {
  const context = values({
    ...values(),
    outputs: { setup: true, functions: false },
    outputDefinitions: { setup: {}, functions: {} }
  });
  assert.equal(render('[[#if Output:setup]]setup[[/if]][[#if Output:functions]]functions[[/if]]', context), 'setup');
  assert.throws(() => render('[[#if Output:missing]]x[[/if]]', context), /Unknown output option/u);
});

function render(source, context = values()) {
  return renderTemplate(parseTemplate(source, 'template.txt', 'Conditional Test'), context);
}

test('conditional templates render truthy, falsey, else, and empty branches', () => {
  assert.equal(render('[[#if true]]yes[[/if]]'), 'yes');
  assert.equal(render('before[[#if false]]hidden[[/if]]after'), 'beforeafter');
  assert.equal(render('[[#if false]]a[[#else]]b[[/if]]'), 'b');
  assert.equal(render('x[[#if true]][[#else]]no[[/if]]y'), 'xy');
  assert.equal(render('[[#if false]]a[[#elseif false]]b[[/if]]'), '');
});

test('conditional templates evaluate elseif branches top-to-bottom and render only the first match', () => {
  const context = values({
    ...values(), prompts: { Element: 'link' },
    promptDefinitions: { Element: { key: 'Element', type: 'input' } }
  });
  const source = '[[#if Prompt:Element == "button"]]button[[#elseif Prompt:Element == "link"]]link[[#elseif true]]later[[#else]]fallback[[/if]]';
  assert.equal(render(source, context), 'link');
});

test('conditional templates remove standalone control lines while preserving content whitespace and inline text', () => {
  const source = 'before\r\n[[#if false]]\r\nhidden\r\n[[#else]]\r\n  shown\r\n[[/if]]\r\nafter';
  assert.equal(render(source), 'before\r\n  shown\r\nafter');
  assert.equal(render('class="button[[#if true]] active[[/if]]"'), 'class="button active"');
  assert.equal(render('const x = `${value}`; [ordinary]'), 'const x = `${value}`; [ordinary]');
});

test('standalone conditional lines do not introduce blank lines between generated object fields', () => {
  const source = [
    'export const Default: Story = {',
    '  args: {',
    '    [[#if true]]',
    "    as: 'article',",
    '    [[/if]]',
    '    [[#if true]]',
    "    children: 'Test Component',",
    '    [[/if]]',
    '    [[#if true]]',
    "    className: ''",
    '    [[/if]]',
    '  }',
    '};'
  ].join('\n');
  assert.equal(render(source), [
    'export const Default: Story = {',
    '  args: {',
    "    as: 'article',",
    "    children: 'Test Component',",
    "    className: ''",
    '  }',
    '};'
  ].join('\n'));
});

test('explicit blank lines inside a conditional body remain under template control', () => {
  assert.equal(render('[[#if true]]\n\nvalue\n[[/if]]\n'), '\nvalue\n');
});

test('conditional templates support built-ins, prompts, raw confirms, records, collections, and custom values', () => {
  const context = values({
    builtIns: { FolderName: 'reading-time', FolderLetter: 'r', DirName: 'molecules', DirLetter: 'm' },
    prompts: { Text: 'hello', Include: 'without-styles', Primary: { extension: 'jsx', isFile: true }, Many: [{}] },
    rawPrompts: { Include: false },
    collections: { Files: [{ name: 'x' }] },
    custom: { Type: 'interactive' },
    promptDefinitions: {
      Text: { key: 'Text', type: 'input' }, Include: { key: 'Include', type: 'confirm' },
      Primary: { key: 'Primary', type: 'selectFromCollection', selection: { mode: 'single' } },
      Many: { key: 'Many', type: 'selectFromCollection', selection: { mode: 'multi' } }
    },
    collectionDefinitions: { Files: {} }, customDefinitions: { Type: {} }
  });
  const source = [
    '[[#if FolderName == "reading-time" and FolderLetter == "r" and DirName == "molecules" and DirLetter == "m"]]B[[/if]]',
    '[[#if Prompt:Text]]P[[/if]]',
    '[[#if not Prompt:Include]]C[[/if]]',
    '[[#if Prompt:Primary.extension == "jsx" and Prompt:Primary.isFile]]R[[/if]]',
    '[[#if Prompt:Many]]M[[/if]]',
    '[[#if Collection:Files]]F[[/if]]',
    '[[#if Custom:Type == "interactive"]]U[[/if]]'
  ].join('');
  assert.equal(render(source, context), 'BPCRMFU');
  assert.equal(render('[[#if Prompt:Primary]]record[[/if]]', context), 'record');
});

test('conditionals and loops nest in both directions with alias fields and metadata', () => {
  const context = values({
    ...values(), prompts: { Items: [
      { name: 'first', enabled: true }, { name: 'second', enabled: false }, { name: 'third', enabled: true }
    ] },
    promptDefinitions: { Items: { key: 'Items', type: 'selectFromCollection', selection: { mode: 'multi' } } }
  });
  const source = '[[#if Prompt:Items]][[#each Prompt:Items as Item]][[#if Item:enabled]][[Item:name]][[#if not Item:@last]],[[/if]][[/if]][[/each]][[#else]]empty[[/if]]';
  assert.equal(render(source, context), 'first,third');
});

test('multi-select prompt fields can be searched with contains', () => {
  const context = values({
    ...values(), prompts: { Items: [{ name: 'title' }, { name: 'primaryButton' }] },
    promptDefinitions: { Items: { key: 'Items', type: 'selectFromCollection', selection: { mode: 'multi' } } }
  });
  assert.equal(render('[[#if Prompt:Items.name contains "Button"]]button[[/if]]', context), 'button');
  assert.equal(render('[[#if Prompt:Items.name contains "Image"]]image[[#else]]field[[/if]]', context), 'field');
});

test('nested conditionals preserve active loop aliases without leaking them', () => {
  const context = values({ ...values(), collections: { Files: [{ name: 'a', extension: 'js' }] } });
  assert.equal(render('[[#each Collection:Files as File]][[#if File:extension == "js"]][[#if File:@first]][[File:name]][[/if]][[/if]][[/each]]', context), 'a');
  assert.throws(() => render('[[#if true]][[File:name]][[/if]]', context), /outside its loop scope/);
});

test('conditional parser rejects every invalid block structure with locations', () => {
  for (const [source, expected] of [
    ['[[#if true]]', /Missing \[\[\/if\]\]/],
    ['[[/if]]', /Unexpected/],
    ['[[#else]]', /outside/],
    ['[[#elseif true]]', /outside/],
    ['[[#if true]][[#else]][[#else]][[/if]]', /at most one/],
    ['[[#if false]][[#else]][[#elseif true]][[/if]]', /after/],
    ['[[#else value]]', /must not include/],
    ['[[#if]]x[[/if]]', /cannot be empty/],
    ['[[#if false]][[#elseif]][[/if]]', /cannot be empty/],
    ['[[#elif true]]', /Unsupported/],
    ['[[/endif]]', /Unsupported/]
  ]) assert.throws(() => parseTemplate(source, 'broken.txt', 'Broken Blueprint'), expected);
  assert.throws(() => parseTemplate('\n[[#if (true]]x[[/if]]', 'broken.txt', 'Broken Blueprint'), /broken\.txt:2:/);
});

test('inactive branches ignore semantic placeholder errors while active branches reject them', () => {
  assert.equal(render('[[#if false]][[UnknownPlaceholder]][[#else]]safe[[/if]]'), 'safe');
  assert.throws(() => render('[[#if true]][[UnknownPlaceholder]][[/if]]'), /Unknown placeholder/);
});

test('dependency analysis is branch-aware and stages later elseif expressions', () => {
  const manifest = normalizeBlueprintManifest({
    version: 1,
    prompts: [
      { key: 'First', type: 'input' }, { key: 'ActiveBody', type: 'input' },
      { key: 'LaterCondition', type: 'input' }, { key: 'InactiveBody', type: 'input' }
    ]
  }, 'Dependencies');
  const template = parseTemplate(
    '[[#if Prompt:First]][[Prompt:ActiveBody]][[#elseif Prompt:LaterCondition]][[Prompt:InactiveBody]][[/if]]',
    'staged.txt'
  );
  const base = { builtIns: {}, prompts: {}, rawPrompts: {}, collections: {}, custom: {} };
  const first = analyzeTemplateDependencies([{ template, pathPlaceholderMatches: [] }], manifest, base);
  assert.deepEqual([...first.promptKeys], ['First']);
  const active = analyzeTemplateDependencies([{ template, pathPlaceholderMatches: [] }], manifest, {
    ...base, prompts: { First: 'yes' }
  });
  assert.deepEqual([...active.promptKeys], ['ActiveBody']);
  const later = analyzeTemplateDependencies([{ template, pathPlaceholderMatches: [] }], manifest, {
    ...base, prompts: { First: '' }
  });
  assert.deepEqual([...later.promptKeys], ['LaterCondition']);
});

test('inactive branch loops and collections are not requested', () => {
  const manifest = normalizeBlueprintManifest({
    version: 1,
    collections: { Files: { type: 'filesystem', source: { scope: 'target', path: 'missing' } } },
    prompts: [{ key: 'Include', type: 'confirm' }]
  }, 'Lazy');
  const template = parseTemplate('[[#if Prompt:Include]][[#each Collection:Files as File]][[File:name]][[/each]][[/if]]', 'lazy.txt');
  const state = { builtIns: {}, prompts: { Include: 'false' }, rawPrompts: { Include: false }, collections: {}, custom: {} };
  const requirements = analyzeTemplateDependencies([{ template, pathPlaceholderMatches: [] }], manifest, state);
  assert.deepEqual([...requirements.collectionKeys], []);
});

test('staged forge input resolution preserves raw confirms and skips inactive prompts and invalid collections', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-condition-stage-'));
  try {
    const manifest = normalizeBlueprintManifest({
      version: 1,
      collections: { Never: { type: 'filesystem', source: { scope: 'target', path: 'does-not-exist' } } },
      prompts: [
        { key: 'Include', type: 'confirm', trueValue: 'with-styles', falseValue: 'without-styles' },
        { key: 'Active', type: 'input' },
        { key: 'Inactive', type: 'input' }
      ]
    }, 'Staged');
    const template = parseTemplate(
      '[[#if Prompt:Include]][[Prompt:Inactive]][[#each Collection:Never as X]][[X:name]][[/each]][[#else]][[Prompt:Active]][[/if]]',
      'staged.txt'
    );
    const seen = [];
    const vscode = { window: {
      showQuickPick: async (items) => items.find((item) => item.rawValue === false),
      showInputBox: async (options) => { seen.push(options.title); return 'active-value'; }
    } };
    const builtIns = { FolderName: 'target', FolderLetter: 't', DirName: 'root', DirLetter: 'r' };
    const result = await resolveRequiredForgeInputs({
      vscode, inspectedSources: [{ template, pathPlaceholderMatches: [] }], manifest, builtInContext: builtIns,
      collectionContext: { blueprintDirectory: root, targetDirectory: root, workspaceDirectory: root, trusted: true },
      promptContext: { targetDirectory: root, targetUri: { fsPath: root }, workspaceDirectories: [root] }
    });
    assert.equal(result.prompts.Include, 'without-styles');
    assert.equal(result.rawPrompts.Include, false);
    assert.equal(result.prompts.Active, 'active-value');
    assert.equal(Object.prototype.hasOwnProperty.call(result.prompts, 'Inactive'), false);
    assert.deepEqual(result.collections, {});
    assert.deepEqual(seen, [undefined]);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('conditionals are rejected in names, manifests, and binary files', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-condition-locations-'));
  try {
    await assert.rejects(inspectSelectedSources([{
      type: 'file', sourcePath: path.join(root, 'missing'), relativePath: '[[#if true]]name[[/if]].txt'
    }]), /unsupported in file and directory names/);
    const binary = path.join(root, 'binary.dat');
    await fsp.writeFile(binary, Buffer.concat([Buffer.from([0]), Buffer.from('[[#if true]]')]));
    await assert.rejects(inspectSelectedSources([{ type: 'file', sourcePath: binary, relativePath: 'binary.dat' }]), /unsupported in binary content/);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('forge planning renders conditions before ordinary placeholders and performs no writes', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-condition-forge-'));
  try {
    const blueprint = path.join(root, 'blueprint');
    const target = path.join(root, 'target');
    await Promise.all([fsp.mkdir(blueprint), fsp.mkdir(target)]);
    const sourcePath = path.join(blueprint, 'output.txt');
    await fsp.writeFile(sourcePath, '[[#if Prompt:Include]]yes [[FolderName]][[#else]]no [[FolderName]][[/if]]');
    const entries = await inspectSelectedSources([{ type: 'file', sourcePath, relativePath: 'output.txt' }]);
    const manifest = normalizeBlueprintManifest({
      version: 1,
      prompts: [{ key: 'Include', type: 'confirm', trueValue: 'enabled', falseValue: 'disabled' }]
    }, 'Conditional Forge');
    const plan = await buildForgePlan({
      blueprintDirectory: blueprint,
      targetDirectory: target,
      sourceEntries: entries,
      context: {
        FolderName: 'target', FolderLetter: 't', DirName: 'root', DirLetter: 'r',
        Prompt: { Include: 'disabled' }, PromptRaw: { Include: false }, Collection: {}, Custom: {}, Manifest: manifest
      }
    });
    assert.equal(plan.files[0].contents.toString(), 'no target');
    assert.deepEqual(await fsp.readdir(target), []);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('omitEmptyFiles skips files whose selected conditional branch renders nothing', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-conditional-empty-'));
  try {
    const blueprint = path.join(root, 'blueprint');
    const target = path.join(root, 'target');
    await Promise.all([fsp.mkdir(blueprint), fsp.mkdir(target)]);
    const sourcePath = path.join(blueprint, 'optional.js');
    await fsp.writeFile(sourcePath, '[[#if Prompt:Variant == "slider"]]\nslider();\n[[/if]]\n');
    const entries = await inspectSelectedSources([{ type: 'file', sourcePath, relativePath: 'optional.js' }]);
    const manifest = normalizeBlueprintManifest({
      version: 1,
      omitEmptyFiles: true,
      prompts: [{
        key: 'Variant', type: 'pick', options: [
          { label: 'Hero', value: 'hero' }, { label: 'Slider', value: 'slider' }
        ]
      }]
    }, 'Conditional Empty File');
    const plan = await buildForgePlan({
      blueprintDirectory: blueprint,
      targetDirectory: target,
      sourceEntries: entries,
      context: {
        FolderName: 'target', FolderLetter: 't', DirName: 'root', DirLetter: 'r',
        Prompt: { Variant: 'hero' }, PromptRaw: { Variant: 'hero' }, Collection: {}, Custom: {}, Manifest: manifest
      }
    });
    assert.deepEqual(plan.files, []);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('an extractor referenced only by an inactive branch is never run', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-foundry-condition-extractor-'));
  try {
    await fsp.writeFile(path.join(root, 'source.txt'), 'source');
    const manifest = normalizeBlueprintManifest({
      version: 1,
      collections: {
        Extracted: {
          type: 'extract', source: { scope: 'target', path: 'source.txt' },
          extract: { type: 'user.spy' }
        }
      },
      prompts: [{ key: 'Include', type: 'confirm' }]
    }, 'Lazy Extractor');
    const template = parseTemplate(
      '[[#if Prompt:Include]][[#each Collection:Extracted as Item]][[Item:name]][[/each]][[#else]]skipped[[/if]]',
      'lazy-extractor.txt'
    );
    let extractorCalls = 0;
    const result = await resolveRequiredForgeInputs({
      vscode: { window: { showQuickPick: async (items) => items.find((item) => item.rawValue === false) } },
      inspectedSources: [{ template, pathPlaceholderMatches: [] }], manifest,
      builtInContext: { FolderName: 'root', FolderLetter: 'r', DirName: 'tmp', DirLetter: 't' },
      collectionContext: {
        blueprintDirectory: root, targetDirectory: root, workspaceDirectory: root, trusted: true,
        extractorRegistry: { get() {
          return { id: 'user.spy', sourceType: 'Custom module', async extract() { extractorCalls += 1; return [{ name: 'ran' }]; } };
        } }
      },
      promptContext: { targetDirectory: root, targetUri: { fsPath: root }, workspaceDirectories: [root] }
    });
    assert.equal(extractorCalls, 0);
    assert.deepEqual(result.collections, {});
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});
