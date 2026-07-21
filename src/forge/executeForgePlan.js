'use strict';

const fs = require('fs');
const path = require('path');

const fsp = fs.promises;

/**
 * Execute a fully validated plan.
 *
 * @param {{targetDirectory: string, directories: import('./buildForgePlan').ForgeDirectory[], files: import('./buildForgePlan').ForgeFile[]}} plan
 * @param {'overwrite' | 'skip'} conflictPolicy
 * @param {{onDirectoryCreated?: Function, onFileCreated?: Function, onFileSkipped?: Function, onFileOverwritten?: Function}} [events]
 * @returns {Promise<{filesCreated: number, foldersCreated: number, filesSkipped: number, filesOverwritten: number}>}
 */
async function executeForgePlan(plan, conflictPolicy, events = {}) {
  if (!['overwrite', 'skip'].includes(conflictPolicy)) {
    throw new Error(`Unsupported conflict policy: ${conflictPolicy}.`);
  }

  await validateExecutionState(plan, conflictPolicy);

  const result = {
    filesCreated: 0,
    foldersCreated: 0,
    filesSkipped: 0,
    filesOverwritten: 0,
    workspaceFilesUpdated: 0
  };

  for (const directory of plan.directories) {
    if (!directory.exists) {
      await fsp.mkdir(directory.destinationPath);
      result.foldersCreated += 1;
      events.onDirectoryCreated?.(directory);
    }
  }

  for (const file of plan.files) {
    if (file.exists && conflictPolicy === 'skip') {
      result.filesSkipped += 1;
      events.onFileSkipped?.(file);
      continue;
    }

    if (file.exists) {
      await fsp.writeFile(file.destinationPath, file.contents);
      result.filesOverwritten += 1;
      events.onFileOverwritten?.(file);
    } else {
      await fsp.writeFile(file.destinationPath, file.contents, { flag: 'wx' });
      result.filesCreated += 1;
      events.onFileCreated?.(file);
    }
  }

  for (const update of plan.workspaceUpdates || []) {
    await fsp.writeFile(update.destinationPath, update.contents);
    result.workspaceFilesUpdated += 1;
    events.onWorkspaceFileUpdated?.(update);
  }

  return result;
}

/**
 * Recheck the full destination state immediately before writing. If anything
 * changed after preflight or the conflict prompt, abort before creating output.
 *
 * @param {{targetDirectory: string, directories: Array<object>, files: Array<object>}} plan
 * @param {'overwrite' | 'skip'} conflictPolicy
 */
async function validateExecutionState(plan, conflictPolicy) {
  const targetStats = await fsp.lstat(plan.targetDirectory);
  if (targetStats.isSymbolicLink() || !targetStats.isDirectory()) {
    throw new Error(`The target directory changed after validation: ${plan.targetDirectory}. Run the forge command again.`);
  }
  await fsp.access(plan.targetDirectory, fs.constants.W_OK);

  for (const directory of plan.directories) {
    await validateSafeAncestors(directory.destinationRoot || plan.targetDirectory, directory.destinationPath);
    const stats = await lstatIfExists(directory.destinationPath);
    validateUnchangedState(directory, stats, 'directory');
    if (stats && !stats.isDirectory()) {
      throw new Error(`Destination is no longer a directory: ${directory.destinationPath}. Run the forge command again.`);
    }
  }

  for (const file of plan.files) {
    await validateSafeAncestors(file.destinationRoot || plan.targetDirectory, file.destinationPath);
    const stats = await lstatIfExists(file.destinationPath);
    validateUnchangedState(file, stats, 'file');
    if (stats && !stats.isFile()) {
      throw new Error(`Destination is no longer a regular file: ${file.destinationPath}. Run the forge command again.`);
    }
    if (stats && conflictPolicy === 'overwrite') {
      await fsp.access(file.destinationPath, fs.constants.W_OK);
    }
  }

  for (const update of plan.workspaceUpdates || []) {
    const stats = await lstatIfExists(update.destinationPath);
    if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Workspace file changed after validation: ${update.destinationPath}. Run the forge command again.`);
    }
    await fsp.access(update.destinationPath, fs.constants.R_OK | fs.constants.W_OK);
    const current = await fsp.readFile(update.destinationPath);
    if (!current.equals(update.originalContents)) {
      throw new Error(`Workspace file contents changed after validation: ${update.destinationPath}. Run the forge command again.`);
    }
  }
}

/** @param {string} targetDirectory @param {string} destinationPath */
async function validateSafeAncestors(targetDirectory, destinationPath) {
  const segments = path.relative(targetDirectory, destinationPath).split(path.sep).slice(0, -1);
  let current = targetDirectory;

  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = await lstatIfExists(current);
    if (!stats) {
      continue;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Destination ancestry changed after validation: ${current}. Run the forge command again.`);
    }
  }
}

/** @param {{exists: boolean, destinationPath: string}} entry @param {fs.Stats | undefined} stats @param {string} type */
function validateUnchangedState(entry, stats, type) {
  if (entry.exists !== Boolean(stats)) {
    throw new Error(`Destination ${type} state changed after validation: ${entry.destinationPath}. Run the forge command again.`);
  }
}

/** @param {string} filePath */
async function lstatIfExists(filePath) {
  try {
    return await fsp.lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

module.exports = { executeForgePlan, validateExecutionState };
