'use strict';

const path = require('path');
const { replacePlaceholders } = require('../placeholders/replacePlaceholders');

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
      if (!/Missing value for Prompt:|Missing value for Custom:/u.test(error.message)) throw error;
    }
  }
  return files;
}

module.exports = { buildVirtualOutputFiles };
