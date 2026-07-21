'use strict';

const fs = require('fs');
const { normalizeDestination } = require('../filesystem/normalizeDestination');
const { replacePlaceholders } = require('../placeholders/replacePlaceholders');
const { normalizeSourcePath } = require('./matchSelectionEntries');

const fsp = fs.promises;

/** Return true when any file owned by an initially selected option already exists in the target. */
async function hasExistingPreselectedFiles({
  fileSelection,
  optionMatches,
  sourceEntries,
  targetDirectory,
  builtInContext
}) {
  if (!fileSelection.enabled) return false;
  const preselectedKeys = fileSelection.options
    .filter((option) => option.required || option.defaultSelected)
    .map((option) => option.key);
  if (preselectedKeys.length === 0) return false;

  const sourceByPath = new Map(sourceEntries.map((entry) => [normalizeSourcePath(entry.relativePath), entry]));
  const candidatePaths = new Set();
  for (const key of preselectedKeys) {
    for (const sourcePath of optionMatches.get(key) || []) candidatePaths.add(sourcePath);
  }

  const candidates = [...candidatePaths].map((sourcePath) => sourceByPath.get(sourcePath)).filter(Boolean);
  return (await findExistingSourcePaths({
    sourceEntries: candidates,
    targetDirectory,
    builtInContext
  })).size > 0;
}

/** Resolve selected source files that already exist at their final destination. */
async function findExistingSourcePaths({
  sourceEntries,
  targetDirectory,
  builtInContext,
  destinationOverrides = new Map()
}) {
  const existing = new Set();
  for (const source of sourceEntries) {
    if (source?.type !== 'file') continue;
    const sourcePath = normalizeSourcePath(source.relativePath);
    let destinationPath;
    try {
      const override = destinationOverrides.get(sourcePath);
      if (override) {
        destinationPath = override.destinationPath;
      } else {
        const outputSegments = sourcePath
          .split('/')
          .map((segment) => replacePlaceholders(segment, builtInContext, source.relativePath));
        destinationPath = normalizeDestination(targetDirectory, outputSegments, source.relativePath);
      }
    } catch (error) {
      if (/Missing value for (?:Prompt|Custom):/u.test(error.message)) continue;
      throw error;
    }
    const stats = await lstatIfExists(destinationPath);
    if (stats?.isFile()) existing.add(sourcePath);
  }
  return existing;
}

async function lstatIfExists(filePath) {
  try {
    return await fsp.lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

module.exports = { findExistingSourcePaths, hasExistingPreselectedFiles };
