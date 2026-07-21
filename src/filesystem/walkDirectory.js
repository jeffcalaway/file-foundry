'use strict';

const fs = require('fs');
const path = require('path');
const { MANIFEST_FILENAME } = require('../manifests/manifestConstants');

const fsp = fs.promises;
const IGNORED_METADATA_FILES = new Set(['.DS_Store', 'Thumbs.db', '.git', MANIFEST_FILENAME, '.file-foundry']);

class UnsupportedSymlinkError extends Error {
  /** @param {string} relativePath */
  constructor(relativePath) {
    super(`Symbolic links are unsupported in blueprints. Source: ${relativePath}.`);
    this.name = 'UnsupportedSymlinkError';
    this.sourceRelativePath = relativePath;
  }
}

/**
 * Recursively enumerate a blueprint without following symbolic links.
 * Directory entries are included so empty directories can be forged.
 *
 * @param {string} rootDirectory
 * @returns {Promise<Array<{type: 'file' | 'directory', sourcePath: string, relativePath: string}>>}
 */
async function walkDirectory(rootDirectory) {
  const entries = [];

  /** @param {string} currentDirectory */
  async function visit(currentDirectory) {
    let children;
    try {
      children = await fsp.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Cannot read blueprint directory ${currentDirectory}: ${error.message}`);
    }

    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      if (IGNORED_METADATA_FILES.has(child.name)) {
        continue;
      }

      const sourcePath = path.join(currentDirectory, child.name);
      const relativePath = path.relative(rootDirectory, sourcePath);
      const stats = await fsp.lstat(sourcePath);

      if (stats.isSymbolicLink()) {
        throw new UnsupportedSymlinkError(relativePath);
      }
      if (stats.isDirectory()) {
        entries.push({ type: 'directory', sourcePath, relativePath });
        await visit(sourcePath);
      } else if (stats.isFile()) {
        entries.push({ type: 'file', sourcePath, relativePath });
      } else {
        throw new Error(`Unsupported blueprint entry type. Source: ${relativePath}.`);
      }
    }
  }

  await visit(rootDirectory);
  return entries;
}

module.exports = { IGNORED_METADATA_FILES, UnsupportedSymlinkError, walkDirectory };
