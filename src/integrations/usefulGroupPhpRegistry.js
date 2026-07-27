'use strict';

const fs = require('fs');
const path = require('path');
const { applyTransform } = require('../placeholders/transforms');

const fsp = fs.promises;

/** Build guarded updates to useful-group/functions.php for selected package outputs. */
async function buildUsefulGroupPhpRegistryUpdates({ vscode, manifest, context, plan, workspaceDirectories }) {
  const definitions = manifest.workspaceEdits.filter((edit) => edit.type === 'usefulGroupPhpRegistry');
  if (definitions.length === 0) return [];

  const candidates = await findUsefulGroupFunctionsFiles(vscode, workspaceDirectories);
  const updates = [];
  for (const definition of definitions) {
    const includeModule = Boolean(context.Output?.[definition.parentModuleOption]);
    const includeFunctions = Boolean(context.Output?.[definition.functionsOption]);
    if (!includeModule && !includeFunctions) continue;

    const moduleName = context.Prompt?.[definition.moduleNamePrompt];
    if (typeof moduleName !== 'string' || !moduleName.trim()) {
      throw new Error(`Workspace edit requires prompt ${JSON.stringify(definition.moduleNamePrompt)}.`);
    }
    const moduleDirectory = applyTransform('KebabCase', moduleName);
    const expectedOutputs = [];
    const parentOutput = includeModule
      ? findSelectedOutput(manifest, definition.parentModuleOption, plan, `class-${moduleDirectory}.php`)
      : undefined;
    const functionsOutput = includeFunctions
      ? findSelectedOutput(manifest, definition.functionsOption, plan, 'functions.php')
      : undefined;
    if (parentOutput) expectedOutputs.push(parentOutput);
    if (functionsOutput) expectedOutputs.push(functionsOutput);

    const candidate = candidates
      .map((functionsPath) => ({ functionsPath, root: path.dirname(functionsPath) }))
      .filter(({ root }) => expectedOutputs.every((output) => isInside(root, output)))
      .sort((left, right) => right.root.length - left.root.length)[0];
    if (!candidate) continue;

    const originalContents = await fsp.readFile(candidate.functionsPath);
    let contents = originalContents.toString('utf8');
    const variableName = applyTransform('SnakeCase', moduleName);
    const className = applyTransform('PascalCase', moduleName);
    if (includeModule) contents = addModuleRegistration(contents, variableName, className);
    if (includeFunctions) {
      const relativeFunctionsPath = path.relative(candidate.root, functionsOutput).split(path.sep).join('/');
      contents = addFunctionsDependency(contents, relativeFunctionsPath);
    }
    const updatedContents = Buffer.from(contents, 'utf8');
    if (!updatedContents.equals(originalContents)) {
      updates.push({
        destinationPath: candidate.functionsPath,
        originalContents,
        contents: updatedContents
      });
    }
  }
  return mergeUpdates(updates);
}

function findSelectedOutput(manifest, optionKey, plan, expectedBasename) {
  const option = manifest.fileSelection?.options.find((item) => item.key === optionKey);
  const literalSources = new Set((option?.files || [])
    .filter((source) => typeof source === 'string')
    .map((source) => source.replace(/\\/gu, '/')));
  const matches = plan.files.filter((file) =>
    literalSources.has(file.sourceRelativePath.replace(/\\/gu, '/')) &&
    path.basename(file.destinationPath) === expectedBasename
  );
  if (matches.length !== 1) {
    throw new Error(
      `Workspace edit could not find the selected ${JSON.stringify(optionKey)} WordPress package output in the forge plan.`
    );
  }
  return matches[0].destinationPath;
}

/** Find real useful-group/functions.php files visible in the current workspace. */
async function findUsefulGroupFunctionsFiles(vscode, workspaceDirectories) {
  const paths = new Set();
  for (const workspaceDirectory of workspaceDirectories) {
    if (path.basename(workspaceDirectory) === 'useful-group') {
      const direct = path.join(workspaceDirectory, 'functions.php');
      if (await isRegularFile(direct)) paths.add(path.resolve(direct));
    }
  }
  const discovered = typeof vscode.workspace.findFiles === 'function'
    ? await vscode.workspace.findFiles(
      '**/useful-group/functions.php',
      '**/{.git,node_modules,vendor}/**'
    )
    : [];
  for (const uri of discovered) {
    if (uri.scheme !== 'file') continue;
    const functionsPath = path.resolve(uri.fsPath);
    if (path.basename(path.dirname(functionsPath)) !== 'useful-group') continue;
    if (!workspaceDirectories.some((root) => isInside(root, functionsPath))) continue;
    if (await isRegularFile(functionsPath)) paths.add(functionsPath);
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

/** Resolve a package namespace from the most relevant useful-group/functions.php. */
async function resolveUsefulGroupPhpNamespace(vscode, context) {
  const candidates = await findUsefulGroupFunctionsFiles(vscode, context.workspaceDirectories || []);
  const targetDirectory = context.targetDirectory ? path.resolve(context.targetDirectory) : undefined;
  const containing = targetDirectory
    ? candidates.filter((functionsPath) => isInside(path.dirname(functionsPath), targetDirectory))
      .sort((left, right) => path.dirname(right).length - path.dirname(left).length)
    : [];
  const functionsPath = containing[0] || (candidates.length === 1 ? candidates[0] : undefined);
  if (!functionsPath) return undefined;
  const source = await fsp.readFile(functionsPath, 'utf8');
  const match = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*;/mu.exec(source);
  return match?.[1] || undefined;
}

/** Add a module property, aligned constructor assignment, and modules-array entry. */
function addModuleRegistration(source, variableName, className) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/u);
  const constructorIndex = lines.findIndex((line) => /function\s+__construct\s*\(/u.test(line));
  if (constructorIndex < 0) throw new Error('useful-group/functions.php has no __construct() method.');

  const propertyPattern = new RegExp(`^\\s*public\\s+\\$${escapeRegex(variableName)};\\s*$`, 'u');
  if (!lines.some((line) => propertyPattern.test(line))) {
    const publicIndexes = lines
      .map((line, index) => /^\s*public\s+\$[A-Za-z_][A-Za-z0-9_]*;\s*$/u.test(line) && index < constructorIndex ? index : -1)
      .filter((index) => index >= 0);
    const lastPublicIndex = publicIndexes[publicIndexes.length - 1];
    const insertAt = publicIndexes.length > 0 ? lastPublicIndex + 1 : constructorIndex;
    const indent = publicIndexes.length > 0 ? /^\s*/u.exec(lines[lastPublicIndex])[0] : '    ';
    lines.splice(insertAt, 0, `${indent}public $${variableName};`);
  }

  let modulesStart = lines.findIndex((line) => /\$this->modules\s*=\s*\[/u.test(line));
  if (modulesStart < 0) throw new Error('useful-group/functions.php has no $this->modules array.');
  let modulesEnd = findArrayEnd(lines, modulesStart);
  const currentConstructorIndex = lines.findIndex((line) => /function\s+__construct\s*\(/u.test(line));
  const assignmentPattern = /^(\s*\$this->([A-Za-z_][A-Za-z0-9_]*))\s*=\s*(new\s+Includes\\[A-Za-z_][A-Za-z0-9_]*\(\);)\s*$/u;
  let assignments = lines
    .map((line, index) => ({ index, match: assignmentPattern.exec(line) }))
    .filter(({ index, match }) => match && index > currentConstructorIndex && index < modulesStart)
    .map(({ index, match }) => ({ index, left: match[1], variable: match[2], right: match[3] }));
  if (!assignments.some((assignment) => assignment.variable === variableName)) {
    const indent = assignments[0] ? /^\s*/u.exec(assignments[0].left)[0] : /^\s*/u.exec(lines[modulesStart])[0];
    const insertAt = assignments.length > 0 ? assignments[assignments.length - 1].index + 1 : modulesStart;
    lines.splice(insertAt, 0, `${indent}$this->${variableName} = new Includes\\${className}();`);
    modulesStart = lines.findIndex((line) => /\$this->modules\s*=\s*\[/u.test(line));
    modulesEnd = findArrayEnd(lines, modulesStart);
  }
  assignments = lines
    .map((line, index) => ({ index, match: assignmentPattern.exec(line) }))
    .filter(({ index, match }) => match && index > currentConstructorIndex && index < modulesStart)
    .map(({ index, match }) => ({ index, left: match[1], variable: match[2], right: match[3] }));
  const width = Math.max(...assignments.map((assignment) => assignment.left.length));
  for (const assignment of assignments) {
    lines[assignment.index] = `${assignment.left.padEnd(width)} = ${assignment.right}`;
  }

  const moduleEntryPattern = new RegExp(`\\$this->${escapeRegex(variableName)}\\b`, 'u');
  if (!lines.slice(modulesStart + 1, modulesEnd).some((line) => moduleEntryPattern.test(line))) {
    const entries = lines.slice(modulesStart + 1, modulesEnd)
      .map((line, offset) => ({ line, index: modulesStart + 1 + offset }))
      .filter(({ line }) => /\$this->[A-Za-z_][A-Za-z0-9_]*/u.test(line));
    const indent = entries[0] ? /^\s*/u.exec(entries[0].line)[0] : `${/^\s*/u.exec(lines[modulesStart])[0]}    `;
    const lastEntry = entries[entries.length - 1];
    if (entries.length > 0 && !/,\s*$/u.test(lastEntry.line)) lines[lastEntry.index] += ',';
    lines.splice(modulesEnd, 0, `${indent}$this->${variableName},`);
  }
  return lines.join(newline);
}

/** Add a generated package functions file to load_dependencies/load_dependancies. */
function addFunctionsDependency(source, relativeFunctionsPath) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => /function\s+load_(?:dependencies|dependancies)\s*\(/u.test(line));
  if (start < 0) throw new Error('useful-group/functions.php has no load_dependencies() method.');
  const end = findBraceEnd(lines, start);
  const dependencyLines = lines
    .map((line, index) => ({ line, index, match: /^\s*require_once\s+([A-Z_][A-Z0-9_]*)\s*\./u.exec(line) }))
    .filter(({ index, match }) => match && index > start && index < end);
  if (dependencyLines.length === 0) {
    throw new Error('useful-group/functions.php load_dependencies() has no require_once line to determine its directory constant.');
  }
  const portable = relativeFunctionsPath.replace(/^\/+|\\/gu, '/');
  if (lines.slice(start + 1, end).some((line) => line.includes(`'${portable}'`))) return source;
  const last = dependencyLines[dependencyLines.length - 1];
  const indent = /^\s*/u.exec(last.line)[0];
  lines.splice(last.index + 1, 0, `${indent}require_once ${last.match[1]} . '${portable}';`);
  return lines.join(newline);
}

function findArrayEnd(lines, start) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\];\s*$/u.test(lines[index])) return index;
  }
  throw new Error('useful-group/functions.php has an unterminated $this->modules array.');
}

function findBraceEnd(lines, start) {
  let depth = 0;
  let opened = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const character of lines[index]) {
      if (character === '{') { depth += 1; opened = true; }
      if (character === '}') depth -= 1;
    }
    if (opened && depth === 0) return index;
  }
  throw new Error('useful-group/functions.php contains an unterminated load_dependencies() method.');
}

function mergeUpdates(updates) {
  const merged = new Map();
  for (const update of updates) {
    const existing = merged.get(update.destinationPath);
    if (existing && !existing.contents.equals(update.contents)) {
      throw new Error(`Multiple workspace edits produced conflicting changes for ${update.destinationPath}.`);
    }
    merged.set(update.destinationPath, update);
  }
  return [...merged.values()];
}

async function isRegularFile(filePath) {
  try {
    const stats = await fsp.lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

module.exports = {
  addFunctionsDependency,
  addModuleRegistration,
  buildUsefulGroupPhpRegistryUpdates,
  findUsefulGroupFunctionsFiles,
  resolveUsefulGroupPhpNamespace
};
