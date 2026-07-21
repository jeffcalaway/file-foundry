'use strict';

const { regexExtractor } = require('./regexExtractor');
const { javascriptPropsExtractor } = require('./javascriptPropsExtractor');
const { wordpressPropsExtractor } = require('./wordpressPropsExtractor');

class ExtractorRegistry {
  constructor() {
    this.extractors = new Map();
    this.register({ id: 'fileFoundry.regex', name: 'Regular Expression', apiVersion: 1, extract: regexExtractor }, { sourceType: 'Built in' });
    this.register({
      id: 'fileFoundry.wordpressProps', name: 'WordPress admit_props', apiVersion: 1,
      supportedExtensions: ['php'], extract: wordpressPropsExtractor
    }, { sourceType: 'Built in' });
    this.register({
      id: 'fileFoundry.javascriptProps', name: 'JavaScript Component Props', apiVersion: 1,
      supportedExtensions: ['js', 'jsx', 'ts', 'tsx'], extract: javascriptPropsExtractor
    }, { sourceType: 'Built in' });
  }

  /** @param {object} definition @param {{sourceType: string, sourcePath?: string, allowOfficial?: boolean}} metadata */
  register(definition, metadata) {
    validateExtractorDefinition(definition);
    if (!metadata.allowOfficial && metadata.sourceType !== 'Built in' && definition.id.startsWith('fileFoundry.')) {
      throw new Error(`Extractor ID ${definition.id} uses the reserved fileFoundry namespace.`);
    }
    if (this.extractors.has(definition.id)) throw new Error(`Duplicate extractor ID ${definition.id}.`);
    this.extractors.set(definition.id, { ...definition, ...metadata });
  }

  get(id) {
    const extractor = this.extractors.get(id);
    if (!extractor) throw new Error(`Unknown extractor ID ${JSON.stringify(id)}.`);
    return extractor;
  }

  list() { return [...this.extractors.values()]; }
}

/** @param {any} definition */
function validateExtractorDefinition(definition) {
  if (!definition || typeof definition !== 'object' || typeof definition.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(definition.id) || typeof definition.name !== 'string' ||
      definition.apiVersion !== 1 || typeof definition.extract !== 'function') {
    throw new Error('Extractor modules require valid id, name, apiVersion 1, and extract function exports.');
  }
  if (definition.supportedExtensions !== undefined &&
      (!Array.isArray(definition.supportedExtensions) || definition.supportedExtensions.some((item) => typeof item !== 'string'))) {
    throw new Error(`Extractor ${definition.id} has invalid supportedExtensions.`);
  }
}

module.exports = { ExtractorRegistry, validateExtractorDefinition };
