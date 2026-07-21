'use strict';

const fs = require('fs');
const path = require('path');
const { replacePlaceholders } = require('../placeholders/replacePlaceholders');
const { normalizeSourcePath } = require('../selection/matchSelectionEntries');

const fsp = fs.promises;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'vendor']);

/** Resolve optional outputs that belong in a discovered workspace destination. */
async function resolveOutputRoutes(options) {
  const activeKeys = new Set(options.selectedOutputKeys);
  const selected = new Map(options.selectedSources.map((entry) => [normalizeSourcePath(entry.relativePath), entry]));
  const overrides = new Map();

  for (const route of options.manifest.outputRoutes) {
    if (!activeKeys.has(route.option)) continue;
    const legacySource = normalizeSourcePath(route.legacySource);
    const modernSource = normalizeSourcePath(route.modernSource);
    if (!selected.has(legacySource) || !selected.has(modernSource)) {
      throw new Error(`Output route sources are not selected for option ${route.option}.`);
    }
    const location = await options.vscode.window.showQuickPick([
      {
        label: 'Template Blocks Folder',
        description: 'Legacy — generate in the theme’s page-builder directory.',
        value: 'templateBlocks'
      },
      {
        label: 'Component Folder',
        description: 'Modern — generate a .block.php file in the component folder.',
        value: 'target'
      }
    ], {
      title: 'Template Block Location',
      placeHolder: 'Choose where to generate the template block.',
      ignoreFocusOut: true
    });
    if (!location) return undefined;

    let destinationDirectory;
    let filename;
    let sourcePath;
    if (location.value === 'target') {
      sourcePath = modernSource;
      selected.delete(legacySource);
      destinationDirectory = options.targetDirectory;
      filename = replacePlaceholders(
        path.basename(route.modernSource),
        options.builtInContext,
        `blueprint.json output route ${route.modernSource}`
      );
    } else {
      sourcePath = legacySource;
      selected.delete(modernSource);
      const result = await resolveUsefulGroupTemplateBlockDirectory({
        targetDirectory: options.targetDirectory,
        workspaceDirectories: options.workspaceDirectories
      });
      if (typeof result !== 'string') {
        removeSourceAndAncestors(selected, legacySource);
        removeSourceAndAncestors(selected, modernSource);
        await options.vscode.window.showWarningMessage(routeWarningResult(result));
        continue;
      }
      destinationDirectory = result;
      filename = replacePlaceholders(
        path.basename(route.legacySource),
        options.builtInContext,
        `blueprint.json output route ${route.legacySource}`
      );
    }
    if (!destinationDirectory) {
      removeSourceAndAncestors(selected, sourcePath);
      continue;
    }
    overrides.set(sourcePath, {
      destinationPath: path.join(destinationDirectory, filename),
      rootDirectory: destinationDirectory
    });
    for (const ancestor of sourceAncestors(sourcePath)) selected.delete(ancestor);
  }

  return { selectedSources: [...selected.values()], destinationOverrides: overrides };
}

async function resolveUsefulGroupTemplateBlockDirectory({ targetDirectory, workspaceDirectories }) {
  const usefulGroup = await findUsefulGroupRoot(targetDirectory, workspaceDirectories);
  if (!usefulGroup) return undefined;
  const templateBlocks = path.join(usefulGroup, 'template-blocks');
  if (!await isRealDirectory(templateBlocks)) return { missing: 'template-blocks', usefulGroup };
  const pageBuilders = await findNamedDirectories(templateBlocks, 'page-builder');
  if (pageBuilders.length === 0) return { missing: 'page-builder', templateBlocks };
  return pageBuilders.sort((left, right) => {
    const depth = path.relative(templateBlocks, left).split(path.sep).length - path.relative(templateBlocks, right).split(path.sep).length;
    return depth || left.localeCompare(right);
  })[0];
}

function routeWarningResult(result) {
  if (result?.missing === 'template-blocks') {
    return `Template Block was not generated because no template-blocks folder exists in ${result.usefulGroup}.`;
  }
  if (result?.missing === 'page-builder') {
    return `Template Block was not generated because no page-builder folder was found inside ${result.templateBlocks}.`;
  }
  return 'Template Block was not generated because no useful-group folder was found for this workspace target.';
}

async function findUsefulGroupRoot(targetDirectory, workspaceDirectories) {
  const target = path.resolve(targetDirectory);
  for (const workspaceDirectory of workspaceDirectories) {
    const workspace = path.resolve(workspaceDirectory);
    if (!isInside(workspace, target)) continue;
    let current = target;
    while (isInside(workspace, current)) {
      if (path.basename(current) === 'useful-group' && await isRealDirectory(current)) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  for (const workspaceDirectory of workspaceDirectories) {
    const workspace = path.resolve(workspaceDirectory);
    if (path.basename(workspace) === 'useful-group' && await isRealDirectory(workspace)) return workspace;
    const child = path.join(workspace, 'useful-group');
    if (await isRealDirectory(child)) return child;
  }
  return undefined;
}

async function findNamedDirectories(root, name) {
  const matches = [];
  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.name === name) matches.push(absolute);
      else await visit(absolute);
    }
  }
  await visit(root);
  return matches;
}

function removeSourceAndAncestors(selected, sourcePath) {
  selected.delete(sourcePath);
  for (const ancestor of sourceAncestors(sourcePath)) selected.delete(ancestor);
}

function sourceAncestors(sourcePath) {
  const segments = sourcePath.split('/');
  const ancestors = [];
  for (let index = 1; index < segments.length; index += 1) ancestors.push(segments.slice(0, index).join('/'));
  return ancestors;
}

async function isRealDirectory(directory) {
  try {
    const stats = await fsp.lstat(directory);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

module.exports = {
  findNamedDirectories,
  findUsefulGroupRoot,
  resolveOutputRoutes,
  resolveUsefulGroupTemplateBlockDirectory,
  routeWarningResult
};
