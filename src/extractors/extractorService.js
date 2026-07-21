'use strict';

const { ExtractorRegistry } = require('./extractorRegistry');
const { loadCustomExtractors } = require('./loadCustomExtractors');
const { loadExtractorPresets } = require('./loadExtractorPresets');

class ExtractorService {
  constructor() { this.registry = new ExtractorRegistry(); this.signature = ''; this.modulePaths = []; }

  /** @param {{presetsFile?: string, customDirectory?: string, trusted: boolean, log?: Function, force?: boolean}} options */
  async ensureLoaded(options) {
    const signature = JSON.stringify([options.presetsFile, options.customDirectory, options.trusted]);
    if (!options.force && signature === this.signature) return this.registry;
    this.registry = new ExtractorRegistry();
    const presets = await loadExtractorPresets(options.presetsFile, this.registry);
    const custom = await loadCustomExtractors(options.customDirectory, this.registry, {
      trusted: options.trusted, clearCache: options.force === true
    });
    this.modulePaths = custom.modulePaths;
    this.signature = signature;
    for (const failure of [...presets.failures, ...custom.failures]) options.log?.(failure);
    for (const id of [...presets.loaded, ...custom.loaded]) options.log?.(`Registered extractor: ${id}`);
    return this.registry;
  }
}

module.exports = { ExtractorService };
