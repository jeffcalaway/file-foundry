'use strict';

const fs = require('fs');
const path = require('path');
const minimatch = require('minimatch');
const { sortCollectionRecords } = require('./sortCollectionRecords');

const fsp = fs.promises;

/** @param {string} sourceRoot @param {object} definition @param {{trusted: boolean, blueprintDirectory: string, log?: Function}} context */
async function resolveFilesystemCollection(sourceRoot, definition, context) {
  if (definition.followSymlinks && !context.trusted) throw new Error('Following collection symlinks requires a trusted workspace.');
  const records = [];
  const seenRealPaths = new Set();
  const rootRealPath = await fsp.realpath(sourceRoot);
  const blueprintRoot = path.resolve(context.blueprintDirectory);

  async function visit(directory, relativeDirectory, depth) {
    const children = await fsp.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (!definition.includeHidden && child.name.startsWith('.')) continue;
      const absolutePath = path.join(directory, child.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      if (path.resolve(sourceRoot) === blueprintRoot && relativePath === 'blueprint.json') continue;
      let stats = await fsp.lstat(absolutePath);
      let realPath = path.resolve(absolutePath);
      if (stats.isSymbolicLink()) {
        if (!definition.followSymlinks) { context.log?.(`Skipped symbolic link: ${absolutePath}`); continue; }
        realPath = await fsp.realpath(absolutePath);
        const relativeReal = path.relative(rootRealPath, realPath);
        if (relativeReal === '..' || relativeReal.startsWith(`..${path.sep}`) || path.isAbsolute(relativeReal)) {
          throw new Error(`Collection symlink escapes source root: ${absolutePath}.`);
        }
        if (seenRealPaths.has(realPath)) continue;
        stats = await fsp.stat(absolutePath);
      } else if (definition.followSymlinks) {
        realPath = await fsp.realpath(absolutePath);
        const relativeReal = path.relative(rootRealPath, realPath);
        if (relativeReal === '..' || relativeReal.startsWith(`..${path.sep}`) || path.isAbsolute(relativeReal)) {
          throw new Error(`Collection entry escapes source root: ${absolutePath}.`);
        }
      }
      const isFolder = stats.isDirectory();
      const isFile = stats.isFile();
      if (!isFolder && !isFile) continue;
      if (seenRealPaths.has(realPath)) continue;
      seenRealPaths.add(realPath);
      const kindMatches = definition.kind === 'any' || definition.kind === (isFile ? 'file' : 'folder');
      if (kindMatches && matchesPatterns(relativePath, definition.include, definition.exclude)) {
        records.push(createFilesystemRecord(relativePath, isFile));
      }
      if (isFolder && definition.recursive && (definition.maxDepth === undefined || depth < definition.maxDepth)) {
        await visit(realPath, relativePath, depth + 1);
      }
    }
  }

  await visit(sourceRoot, '', 0);
  return sortCollectionRecords(records, definition.sort);
}

/** @param {string} relativePath @param {boolean} isFile */
function createFilesystemRecord(relativePath, isFile) {
  const segments = relativePath.split('/');
  const name = segments[segments.length - 1];
  const extensionWithDot = isFile ? path.posix.extname(name) : '';
  return {
    kind: isFile ? 'file' : 'folder',
    name,
    stem: extensionWithDot ? name.slice(0, -extensionWithDot.length) : name,
    extension: extensionWithDot.slice(1),
    relativePath,
    parentName: segments.length > 1 ? segments[segments.length - 2] : '',
    parentRelativePath: segments.length > 1 ? segments.slice(0, -1).join('/') : '.',
    depth: segments.length - 1,
    isFile,
    isFolder: !isFile
  };
}

/** @param {string} relativePath @param {string[]} include @param {string[]} exclude */
function matchesPatterns(relativePath, include, exclude) {
  const options = { dot: true, nonegate: true, nocomment: true };
  const included = include.length === 0 || include.some((pattern) => minimatch(relativePath, pattern, options));
  return included && !exclude.some((pattern) => minimatch(relativePath, pattern, options));
}

module.exports = { createFilesystemRecord, matchesPatterns, resolveFilesystemCollection };
