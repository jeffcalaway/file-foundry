'use strict';

const fs = require('fs');
const path = require('path');
const { replacePlaceholders } = require('../placeholders/replacePlaceholders');

const fsp = fs.promises;

/** @param {object} source @param {object} context @param {'file'|'directory'} expected */
async function resolveCollectionSource(source, context, expected) {
  const roots = {
    blueprint: context.blueprintDirectory,
    target: context.targetDirectory,
    targetParent: path.dirname(context.targetDirectory),
    workspace: context.workspaceDirectory
  };
  const root = roots[source.scope];
  if (!root) throw new Error(`Collection source scope ${source.scope} cannot be resolved for this target.`);
  const replaced = replacePlaceholders(source.path, context.placeholderContext, 'blueprint.json collection source');
  if (path.isAbsolute(replaced)) throw new Error(`Collection source path became absolute: ${replaced}.`);
  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, replaced);
  const relative = path.relative(rootPath, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Collection source path escapes its ${source.scope} scope: ${source.path}.`);
  }
  if (expected === 'file' && context.virtualFiles?.has(resolved)) {
    return resolved;
  }
  let stats;
  try {
    const [rootRealPath, resolvedRealPath] = await Promise.all([fsp.realpath(rootPath), fsp.realpath(resolved)]);
    const realRelative = path.relative(rootRealPath, resolvedRealPath);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      throw new Error('resolved symbolic links escape the source scope');
    }
    stats = await fsp.stat(resolved);
    await fsp.access(resolved, fs.constants.R_OK);
  } catch (error) {
    throw new Error(`Collection source is unavailable: ${resolved} (${error.message}).`);
  }
  if (expected === 'file' ? !stats.isFile() : !stats.isDirectory()) {
    throw new Error(`Collection source must be a readable ${expected}: ${resolved}.`);
  }
  return resolved;
}

module.exports = { resolveCollectionSource };
