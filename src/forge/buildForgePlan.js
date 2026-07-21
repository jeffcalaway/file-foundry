'use strict';

const fs = require('fs');
const path = require('path');
const { isBinaryBuffer } = require('../filesystem/detectBinary');
const { normalizeDestination } = require('../filesystem/normalizeDestination');
const { walkDirectory } = require('../filesystem/walkDirectory');
const { createContext } = require('../placeholders/createContext');
const { replacePlaceholders } = require('../placeholders/replacePlaceholders');
const { renderTemplate } = require('../templates/renderTemplate');
const { applySourceFormatters } = require('../formatters/alignAssignments');

const fsp = fs.promises;

/**
 * Build the complete output plan and file payloads before any write occurs.
 *
 * @param {{blueprintDirectory: string, targetDirectory: string, sourceEntries?: Array<object>, context?: Record<string, any>}} options
 * @returns {Promise<{
 *   blueprintDirectory: string,
 *   targetDirectory: string,
 *   context: Record<string, string>,
 *   directories: Array<ForgeDirectory>,
 *   files: Array<ForgeFile>,
 *   conflicts: ForgeFile[]
 * }>}
 */
async function buildForgePlan({
  blueprintDirectory,
  targetDirectory,
  sourceEntries: providedEntries,
  context: providedContext,
  destinationOverrides = new Map(),
  skipExistingFiles = false
}) {
  const targetRoot = path.resolve(targetDirectory);
  const blueprintRoot = path.resolve(blueprintDirectory);

  await validateRootDirectory(targetRoot, 'target', fs.constants.R_OK | fs.constants.W_OK);
  await validateRootDirectory(blueprintRoot, 'blueprint', fs.constants.R_OK);

  const context = providedContext || createContext(targetRoot);
  const sourceEntries = providedEntries || await walkDirectory(blueprintRoot);
  const directories = [];
  const files = [];
  const destinations = new Map();

  for (const entry of sourceEntries) {
    const override = destinationOverrides.get(entry.relativePath.replace(/\\/gu, '/'));
    const destinationRoot = override ? path.resolve(override.rootDirectory) : targetRoot;
    let destinationPath;
    if (override) {
      await validateRootDirectory(destinationRoot, 'routed output', fs.constants.R_OK | fs.constants.W_OK);
      const relativeOverride = path.relative(destinationRoot, path.resolve(override.destinationPath));
      destinationPath = normalizeDestination(destinationRoot, relativeOverride.split(path.sep), entry.relativePath);
    } else {
      const sourceSegments = entry.relativePath.split(path.sep);
      const outputSegments = sourceSegments.map((segment) =>
        replacePlaceholders(segment, context, entry.relativePath)
      );
      destinationPath = normalizeDestination(targetRoot, outputSegments, entry.relativePath);
    }
    const collisionKey = destinationCollisionKey(destinationPath);

    if (destinations.has(collisionKey)) {
      const previousSource = destinations.get(collisionKey);
      throw new Error(
        `Multiple blueprint entries resolve to the same destination ${JSON.stringify(path.relative(targetRoot, destinationPath))}: ` +
        `${previousSource} and ${entry.relativePath}.`
      );
    }
    destinations.set(collisionKey, entry.relativePath);

    await validateDestinationAncestors(destinationRoot, destinationPath);
    const existingStats = await lstatIfExists(destinationPath);

    if (entry.type === 'directory') {
      if (existingStats && !existingStats.isDirectory()) {
        throw new Error(`Cannot create directory because a non-directory already exists. Source: ${entry.relativePath}. Destination: ${destinationPath}.`);
      }
      directories.push({
        sourcePath: entry.sourcePath,
        sourceRelativePath: entry.relativePath,
        destinationPath,
        destinationRoot,
        destinationRelativePath: path.relative(targetRoot, destinationPath),
        exists: Boolean(existingStats)
      });
      continue;
    }

    if (existingStats && !existingStats.isFile()) {
      throw new Error(`Cannot create file because the destination is not a regular file. Source: ${entry.relativePath}. Destination: ${destinationPath}.`);
    }

    if (existingStats && skipExistingFiles) {
      files.push({
        sourcePath: entry.sourcePath,
        sourceRelativePath: entry.relativePath,
        destinationPath,
        destinationRoot,
        destinationRelativePath: path.relative(targetRoot, destinationPath),
        exists: true,
        binary: false,
        contents: Buffer.alloc(0)
      });
      continue;
    }

    let sourceBuffer = entry.sourceBuffer;
    if (!Buffer.isBuffer(sourceBuffer)) {
      try {
        sourceBuffer = await fsp.readFile(entry.sourcePath);
      } catch (error) {
        throw new Error(`Cannot read blueprint file. Source: ${entry.relativePath}. ${error.message}`);
      }
    }

    const binary = typeof entry.binary === 'boolean' ? entry.binary : isBinaryBuffer(sourceBuffer);
    let outputBuffer = sourceBuffer;
    if (!binary) {
      let loopRendered;
      try {
        loopRendered = entry.template
          ? renderTemplate(entry.template, {
            builtIns: context,
            collections: context.Collection || {},
            prompts: context.Prompt || {},
            rawPrompts: context.PromptRaw || {},
            custom: context.Custom || {},
            promptDefinitions: context.Manifest
              ? Object.fromEntries(context.Manifest.prompts.map((prompt) => [prompt.key, prompt])) : undefined,
            collectionDefinitions: context.Manifest?.collections,
            customDefinitions: context.Manifest?.placeholders,
            outputs: context.Output || {},
            outputDefinitions: context.Manifest
              ? Object.fromEntries(context.Manifest.fileSelection.options.map((option) => [option.key, option])) : undefined
          })
          : sourceBuffer.toString('utf8');
      } catch (error) {
        throw new Error(`Loop rendering failed. Source: ${entry.relativePath}. ${error.message}`);
      }
      const replaced = replacePlaceholders(loopRendered, context, entry.relativePath);
      outputBuffer = Buffer.from(
        applySourceFormatters(replaced, entry.relativePath, context.Manifest?.formatters),
        'utf8'
      );
      if (/\[\[(?:#|\/)/u.test(outputBuffer.toString('utf8'))) {
        throw new Error(`Unresolved block directive syntax remains. Source: ${entry.relativePath}.`);
      }
      if (context.Manifest?.omitEmptyFiles && outputBuffer.length === 0) {
        continue;
      }
    }

    files.push({
      sourcePath: entry.sourcePath,
      sourceRelativePath: entry.relativePath,
      destinationPath,
      destinationRoot,
      destinationRelativePath: path.relative(targetRoot, destinationPath),
      exists: Boolean(existingStats),
      binary,
      contents: outputBuffer
    });
  }

  directories.sort((left, right) => pathDepth(left.destinationRelativePath) - pathDepth(right.destinationRelativePath));
  files.sort((left, right) => {
    const routedOrder = Number(left.destinationRoot !== targetRoot) - Number(right.destinationRoot !== targetRoot);
    return routedOrder || left.destinationRelativePath.localeCompare(right.destinationRelativePath);
  });

  return {
    blueprintDirectory: blueprintRoot,
    targetDirectory: targetRoot,
    context,
    directories,
    files,
    conflicts: files.filter((file) => file.exists)
  };
}

/**
 * @typedef {object} ForgeDirectory
 * @property {string} sourcePath
 * @property {string} sourceRelativePath
 * @property {string} destinationPath
 * @property {string} destinationRelativePath
 * @property {boolean} exists
 */

/**
 * @typedef {object} ForgeFile
 * @property {string} sourcePath
 * @property {string} sourceRelativePath
 * @property {string} destinationPath
 * @property {string} destinationRelativePath
 * @property {boolean} exists
 * @property {boolean} binary
 * @property {Buffer} contents
 */

/** @param {string} relativePath */
function pathDepth(relativePath) {
  return relativePath.split(path.sep).length;
}

/** @param {string} destinationPath */
function destinationCollisionKey(destinationPath) {
  const normalized = path.normalize(destinationPath);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalized.toLocaleLowerCase('en-US')
    : normalized;
}

/**
 * Reject destination ancestors that are symlinks or non-directories. This keeps
 * writes inside the selected target even when its existing contents are hostile.
 *
 * @param {string} targetRoot
 * @param {string} destinationPath
 */
async function validateDestinationAncestors(targetRoot, destinationPath) {
  const relative = path.relative(targetRoot, destinationPath);
  const segments = relative.split(path.sep).slice(0, -1);
  let current = targetRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = await lstatIfExists(current);
    if (!stats) {
      continue;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Destination path traverses a symbolic link, which is unsafe: ${current}.`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Destination path traverses a non-directory: ${current}.`);
    }
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

/** @param {string} directory @param {string} label @param {number} accessMode */
async function validateRootDirectory(directory, label, accessMode) {
  let stats;
  try {
    stats = await fsp.lstat(directory);
    await fsp.access(directory, accessMode);
  } catch (error) {
    throw new Error(`The ${label} directory is unavailable: ${directory} (${error.message}).`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`The ${label} directory cannot be a symbolic link: ${directory}.`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`The ${label} path is not a directory: ${directory}.`);
  }
}

module.exports = {
  buildForgePlan,
  destinationCollisionKey,
  lstatIfExists,
  validateDestinationAncestors,
  validateRootDirectory
};
