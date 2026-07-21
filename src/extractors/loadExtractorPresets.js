'use strict';

const fs = require('fs');
const { detectDuplicateJsonKeys } = require('../manifests/detectDuplicateJsonKeys');

const fsp = fs.promises;

/** @param {string | undefined} filePath @param {import('./extractorRegistry').ExtractorRegistry} registry */
async function loadExtractorPresets(filePath, registry) {
  const failures = [];
  if (!filePath) return { loaded: [], failures };
  let source;
  try { source = await fsp.readFile(filePath, 'utf8'); } catch (error) {
    return { loaded: [], failures: [`Cannot read extractor presets ${filePath}: ${error.message}`] };
  }
  let document;
  try { document = JSON.parse(source); } catch (error) {
    return { loaded: [], failures: [`Invalid extractor presets JSON: ${error.message}`] };
  }
  if (detectDuplicateJsonKeys(source).length) return { loaded: [], failures: ['Extractor presets contain duplicate JSON keys.'] };
  if (document.version !== 1 || !document.extractors || typeof document.extractors !== 'object') {
    return { loaded: [], failures: ['Extractor presets require version 1 and an extractors object.'] };
  }
  const loaded = [];
  for (const [id, preset] of Object.entries(document.extractors)) {
    try {
      if (id.startsWith('fileFoundry.') || !id.includes('.') || !preset || typeof preset !== 'object') {
        throw new Error('Preset IDs must be user-namespaced and cannot use fileFoundry.*.');
      }
      const base = registry.get(preset.extends);
      if (base.sourceType !== 'Built in') throw new Error('Presets may extend built-in extractors only.');
      if (preset.options !== undefined && (!preset.options || typeof preset.options !== 'object' || Array.isArray(preset.options))) {
        throw new Error('Preset options must be an object.');
      }
      registry.register({
        id, name: preset.name || id, apiVersion: 1, supportedExtensions: base.supportedExtensions,
        extract: (input) => base.extract({ ...input, options: { ...(preset.options || {}), ...(input.options || {}) } })
      }, { sourceType: 'Preset', sourcePath: filePath });
      loaded.push(id);
    } catch (error) { failures.push(`${id}: ${error.message}`); }
  }
  return { loaded, failures };
}

module.exports = { loadExtractorPresets };
