'use strict';

const { normalizeSourcePath } = require('./matchSelectionEntries');

/**
 * @param {{enabled: boolean, includeUnlisted: boolean, options: Array<{key: string, required: boolean}>}} fileSelection
 * @param {Array<{relativePath: string}>} sourceEntries
 * @param {Map<string, Set<string>>} optionMatches
 * @param {string[]} selectedOptionKeys
 */
function resolveSelectedSources(fileSelection, sourceEntries, optionMatches, selectedOptionKeys) {
  if (!fileSelection.enabled) {
    return [...sourceEntries];
  }

  const selectedKeys = new Set(selectedOptionKeys);
  for (const option of fileSelection.options) {
    if (option.required) {
      selectedKeys.add(option.key);
    }
  }

  const selectedPaths = new Set();
  const listedPaths = new Set();
  for (const [key, paths] of optionMatches) {
    for (const sourcePath of paths) {
      listedPaths.add(sourcePath);
      if (selectedKeys.has(key)) {
        selectedPaths.add(sourcePath);
      }
    }
  }
  if (fileSelection.includeUnlisted) {
    for (const entry of sourceEntries) {
      const sourcePath = normalizeSourcePath(entry.relativePath);
      if (!listedPaths.has(sourcePath)) {
        selectedPaths.add(sourcePath);
      }
    }
  }

  const entryByPath = new Map(sourceEntries.map((entry) => [normalizeSourcePath(entry.relativePath), entry]));
  for (const sourcePath of [...selectedPaths]) {
    const segments = sourcePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join('/');
      if (entryByPath.get(ancestor)?.type === 'directory') {
        selectedPaths.add(ancestor);
      }
    }
  }

  return sourceEntries.filter((entry) => selectedPaths.has(normalizeSourcePath(entry.relativePath)));
}

module.exports = { resolveSelectedSources };
