'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const fsp = fs.promises;

/**
 * @param {string} configuredPath
 * @param {{targetDirectory?: string, workspaceDirectories?: string[]}} [options]
 * @returns {Promise<string>}
 */
async function resolveBlueprintDirectory(configuredPath, options = {}) {
  if (typeof configuredPath !== 'string' || configuredPath.trim() === '') {
    throw new Error('No blueprint directory is configured.');
  }

  let candidate = configuredPath.trim();
  if (candidate === '~') {
    candidate = os.homedir();
  } else if (candidate.startsWith(`~${path.sep}`) || candidate.startsWith('~/') || candidate.startsWith('~\\')) {
    candidate = path.join(os.homedir(), candidate.slice(2));
  }

  if (!path.isAbsolute(candidate)) {
    const workspaceDirectories = options.workspaceDirectories || [];
    const containingWorkspace = options.targetDirectory
      ? workspaceDirectories
        .filter((workspaceDirectory) => isInside(workspaceDirectory, options.targetDirectory))
        .sort((left, right) => right.length - left.length)[0]
      : undefined;
    const baseDirectory = containingWorkspace || workspaceDirectories[0];

    if (!baseDirectory) {
      throw new Error('The blueprint directory is relative, but no workspace folder is open. Configure an absolute path or open a workspace folder.');
    }
    candidate = path.resolve(baseDirectory, candidate);
  } else {
    candidate = path.resolve(candidate);
  }

  let stats;
  try {
    stats = await fsp.stat(candidate);
    await fsp.access(candidate, fs.constants.R_OK);
  } catch (error) {
    throw new Error(`The configured blueprint directory cannot be read: ${candidate} (${error.message}).`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`The configured blueprint path is not a directory: ${candidate}.`);
  }

  return candidate;
}

/** @param {string} parent @param {string} child */
function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

module.exports = { isInside, resolveBlueprintDirectory };
