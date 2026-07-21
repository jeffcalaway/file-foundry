'use strict';

const fs = require('fs');
const path = require('path');

const fsp = fs.promises;

/**
 * @param {string | undefined} directory
 * @param {import('./extractorRegistry').ExtractorRegistry} registry
 * @param {{trusted: boolean, clearCache?: boolean}} options
 */
async function loadCustomExtractors(directory, registry, options) {
  const loaded = [];
  const failures = [];
  const modulePaths = [];
  if (!directory) return { loaded, failures, modulePaths };
  if (!options.trusted) return { loaded, modulePaths, failures: ['Custom extractors are disabled in untrusted workspaces.'] };
  let entries;
  try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch (error) {
    return { loaded, modulePaths, failures: [`Cannot read custom extractor directory ${directory}: ${error.message}`] };
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !['.js', '.cjs'].includes(path.extname(entry.name))) continue;
    const modulePath = path.resolve(directory, entry.name);
    try {
      if (options.clearCache) delete require.cache[require.resolve(modulePath)];
      const definition = require(modulePath);
      registry.register(definition, { sourceType: 'Custom module', sourcePath: modulePath });
      loaded.push(definition.id);
      modulePaths.push(modulePath);
    } catch (error) { failures.push(`${modulePath}: ${error.message}`); }
  }
  return { loaded, failures, modulePaths };
}

module.exports = { loadCustomExtractors };
