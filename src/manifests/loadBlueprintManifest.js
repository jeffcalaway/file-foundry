'use strict';

const fs = require('fs');
const path = require('path');
const { detectDuplicateJsonKeys } = require('./detectDuplicateJsonKeys');
const { MANIFEST_FILENAME } = require('./manifestConstants');
const { normalizeBlueprintManifest } = require('./normalizeBlueprintManifest');
const { manifestError, validateBlueprintManifest } = require('./validateBlueprintManifest');

const fsp = fs.promises;

/**
 * @param {string} blueprintDirectory
 * @returns {Promise<{manifest: object | undefined, warnings: string[], path: string}>}
 */
async function loadBlueprintManifest(blueprintDirectory) {
  const directoryName = path.basename(blueprintDirectory);
  const manifestPath = path.join(blueprintDirectory, MANIFEST_FILENAME);
  let source;
  try {
    source = await fsp.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { manifest: undefined, warnings: [], path: manifestPath };
    }
    throw manifestError(directoryName, `The manifest cannot be read: ${error.message}`);
  }

  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw manifestError(directoryName, `Invalid JSON: ${error.message}`);
  }

  const duplicates = detectDuplicateJsonKeys(source);
  if (duplicates.length > 0) {
    throw manifestError(directoryName, `Duplicate JSON key${duplicates.length === 1 ? '' : 's'}: ${duplicates.join(', ')}.`);
  }

  const { warnings } = validateBlueprintManifest(value, directoryName);
  return {
    manifest: normalizeBlueprintManifest(value, directoryName),
    warnings,
    path: manifestPath
  };
}

module.exports = { loadBlueprintManifest };
