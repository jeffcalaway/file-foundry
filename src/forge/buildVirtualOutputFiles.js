'use strict';

const path = require('path');
const {
  isDeferredPlaceholderValueError,
  replacePlaceholders
} = require('../placeholders/replacePlaceholders');

/** Map selected in-memory blueprint files to their prospective target paths. */
function buildVirtualOutputFiles(inspectedSources, targetDirectory, builtInContext) {
  const files = new Map();
  for (const source of inspectedSources) {
    if (source.type !== 'file' || !Buffer.isBuffer(source.sourceBuffer)) continue;
    try {
      const relativePath = replacePlaceholders(
        source.relativePath,
        builtInContext,
        `virtual output ${source.relativePath}`
      );
      files.set(path.resolve(targetDirectory, relativePath), source.sourceBuffer);
    } catch (error) {
      if (!isDeferredPlaceholderValueError(error)) throw error;
    }
  }
  return files;
}

module.exports = { buildVirtualOutputFiles };
