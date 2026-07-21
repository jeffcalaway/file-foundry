'use strict';

const path = require('path');
const { isInside } = require('../blueprints/resolveBlueprintDirectory');

/**
 * @param {import('vscode')} vscode
 * @param {object} definition
 * @param {{targetDirectory: string, targetUri: import('vscode').Uri, workspaceDirectories: string[]}} context
 */
async function promptPath(vscode, definition, context) {
  const isFile = definition.type === 'file';
  const selections = await vscode.window.showOpenDialog({
    title: definition.title,
    defaultUri: context.targetUri,
    canSelectFiles: isFile,
    canSelectFolders: !isFile,
    canSelectMany: false,
    openLabel: isFile ? 'Select File' : 'Select Folder',
    filters: isFile ? definition.filters : undefined
  });
  if (!selections?.[0]) {
    return undefined;
  }
  if (selections[0].scheme !== 'file') {
    throw new Error(`${definition.title || definition.key} requires a local file-system selection.`);
  }
  return formatSelectedPath(selections[0].fsPath, definition.pathFormat, context);
}

/**
 * @param {string} selectedPath
 * @param {string} pathFormat
 * @param {{targetDirectory: string, workspaceDirectories: string[]}} context
 */
function formatSelectedPath(selectedPath, pathFormat, context) {
  const absolute = path.resolve(selectedPath);
  if (pathFormat === 'absolute') {
    return absolute;
  }
  if (pathFormat === 'basename') {
    return path.basename(absolute);
  }
  if (pathFormat === 'targetRelative') {
    const relative = path.relative(context.targetDirectory, absolute);
    if (path.isAbsolute(relative)) {
      throw new Error(`Cannot create a target-relative path from ${context.targetDirectory} to ${absolute}.`);
    }
    return relative;
  }

  const workspaceDirectory = context.workspaceDirectories
    .filter((directory) => isInside(directory, absolute))
    .sort((left, right) => right.length - left.length)[0];
  if (!workspaceDirectory) {
    throw new Error(`Cannot create a workspace-relative path because ${absolute} is outside every open workspace folder.`);
  }
  return path.relative(workspaceDirectory, absolute);
}

module.exports = { formatSelectedPath, promptPath };
