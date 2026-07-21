'use strict';

const fs = require('fs');
const { isBinaryBuffer } = require('../filesystem/detectBinary');
const { scanPlaceholders } = require('../placeholders/scanPlaceholders');
const { parseTemplate } = require('../templates/parseTemplate');

const fsp = fs.promises;

/**
 * Read and validate only selected sources. Unselected file contents and names
 * never enter placeholder dependency analysis.
 *
 * @param {Array<{type: string, sourcePath: string, relativePath: string}>} entries
 * @param {{blueprintName?: string}} [options]
 */
async function inspectSelectedSources(entries, options = {}) {
  const inspected = [];

  for (const entry of entries) {
    if (entry.relativePath.includes('[[#') || entry.relativePath.includes('[[/')) {
      throw new Error(`Loop and conditional directives are unsupported in file and directory names. Source: ${entry.relativePath}.`);
    }
    const pathMatches = scanPlaceholders(entry.relativePath, entry.relativePath);
    if (entry.type === 'directory') {
      inspected.push({ ...entry, pathPlaceholderMatches: pathMatches, placeholderMatches: pathMatches });
      continue;
    }

    let sourceBuffer;
    try {
      sourceBuffer = await fsp.readFile(entry.sourcePath);
    } catch (error) {
      throw new Error(`Cannot read blueprint file. Source: ${entry.relativePath}. ${error.message}`);
    }
    const binary = isBinaryBuffer(sourceBuffer);
    if (binary && /\[\[(?:#|\/)/u.test(sourceBuffer.toString('latin1'))) {
      throw new Error(`Block directives are unsupported in binary content. Source: ${entry.relativePath}.`);
    }
    const template = binary ? undefined : parseTemplate(sourceBuffer.toString('utf8'), entry.relativePath, options.blueprintName);
    const contentMatches = template?.placeholderMatches || [];
    inspected.push({
      ...entry,
      binary,
      sourceBuffer,
      template,
      pathPlaceholderMatches: pathMatches,
      placeholderMatches: [...pathMatches, ...contentMatches]
    });
  }

  return inspected;
}

module.exports = { inspectSelectedSources };
