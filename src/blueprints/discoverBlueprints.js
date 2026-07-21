'use strict';

const fs = require('fs');
const path = require('path');
const { IGNORED_METADATA_FILES } = require('../filesystem/walkDirectory');
const { loadBlueprintManifest } = require('../manifests/loadBlueprintManifest');

const fsp = fs.promises;
const MANIFEST_READ_CONCURRENCY = 8;

/**
 * Treat each immediate child directory as one selectable blueprint.
 *
 * @param {string} blueprintRoot
 * @returns {Promise<Array<{name: string, directory: string}>>}
 */
async function discoverBlueprints(blueprintRoot) {
  const children = await fsp.readdir(blueprintRoot, { withFileTypes: true });
  const directories = children
    .filter((entry) => entry.isDirectory() && !IGNORED_METADATA_FILES.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const blueprints = await mapWithConcurrency(directories, MANIFEST_READ_CONCURRENCY, async (entry) => {
    const directory = path.join(blueprintRoot, entry.name);
    try {
      const loaded = await loadBlueprintManifest(directory);
      return {
        name: loaded.manifest?.name || entry.name,
        directoryName: entry.name,
        description: loaded.manifest?.description,
        directory,
        manifest: loaded.manifest,
        warnings: loaded.warnings
      };
    } catch (error) {
      return {
        name: entry.name,
        directoryName: entry.name,
        description: 'Invalid blueprint manifest',
        directory,
        manifestError: error,
        warnings: []
      };
    }
  });
  return blueprints.sort((left, right) =>
    left.name.localeCompare(right.name) || left.directoryName.localeCompare(right.directoryName)
  );
}

async function mapWithConcurrency(items, concurrency, map) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await map(items[index], index);
    }
  }
  const workerCount = Math.min(items.length, concurrency);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

module.exports = { MANIFEST_READ_CONCURRENCY, discoverBlueprints, mapWithConcurrency };
