'use strict';

const path = require('path');
const minimatch = require('minimatch');
const { MANIFEST_FILENAME } = require('../manifests/manifestConstants');

/**
 * Match every file-selection option against source names before replacement.
 *
 * @param {{enabled: boolean, options: Array<{key: string, files: Array<string | {glob: string}>}>}} fileSelection
 * @param {Array<{type: string, relativePath: string}>} sourceEntries
 * @returns {Map<string, Set<string>>}
 */
function matchSelectionEntries(fileSelection, sourceEntries) {
  const matches = new Map();
  const entryByPath = new Map(sourceEntries.map((entry) => [normalizeSourcePath(entry.relativePath), entry]));
  for (const option of fileSelection.options) {
    const optionMatches = new Set();
    for (const selector of option.files) {
      if (typeof selector === 'string') {
        const literal = validateSelectorPath(selector, `literal path in option ${JSON.stringify(option.key)}`);
        const matchedEntry = entryByPath.get(literal);
        if (!matchedEntry) {
          throw new Error(`File-selection option ${JSON.stringify(option.key)} references missing source path ${JSON.stringify(selector)}.`);
        }
        optionMatches.add(literal);
        if (matchedEntry.type === 'directory') {
          for (const sourcePath of entryByPath.keys()) {
            if (sourcePath.startsWith(`${literal}/`)) {
              optionMatches.add(sourcePath);
            }
          }
        }
      } else {
        const pattern = validateSelectorPath(selector.glob, `glob in option ${JSON.stringify(option.key)}`, true);
        if (pattern.includes('[[') || pattern.includes(']]')) {
          throw new Error(`Glob patterns cannot contain placeholder syntax: ${JSON.stringify(selector.glob)}.`);
        }
        const globMatches = [...entryByPath.keys()].filter((sourcePath) =>
          minimatch(sourcePath, pattern, { dot: true, nonegate: true, nocomment: true })
        );
        if (globMatches.length === 0) {
          throw new Error(`Glob ${JSON.stringify(selector.glob)} in option ${JSON.stringify(option.key)} matches no blueprint sources.`);
        }
        for (const sourcePath of globMatches) {
          optionMatches.add(sourcePath);
        }
      }
    }
    includeAncestorDirectories(optionMatches, entryByPath);
    matches.set(option.key, optionMatches);
  }
  return matches;
}

/** @param {Set<string>} selected @param {Map<string, object>} entryByPath */
function includeAncestorDirectories(selected, entryByPath) {
  for (const sourcePath of [...selected]) {
    const segments = sourcePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join('/');
      if (entryByPath.get(ancestor)?.type === 'directory') {
        selected.add(ancestor);
      }
    }
  }
}

/** @param {string} selector @param {string} label @param {boolean} [glob] */
function validateSelectorPath(selector, label, glob = false) {
  const portable = selector.replace(/\\/gu, '/');
  if (
    path.posix.isAbsolute(portable) ||
    /^[A-Za-z]:\//u.test(portable) ||
    portable.split('/').includes('..')
  ) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(selector)}.`);
  }
  const normalized = path.posix.normalize(portable).replace(/^\.\//u, '').replace(/\/$/u, '');
  if (!normalized || normalized === '.' || normalized.toLowerCase() === MANIFEST_FILENAME) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(selector)}.`);
  }
  if (!glob && normalized.includes('\0')) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(selector)}.`);
  }
  return normalized;
}

/** @param {string} relativePath */
function normalizeSourcePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

module.exports = { matchSelectionEntries, normalizeSourcePath, validateSelectorPath };
