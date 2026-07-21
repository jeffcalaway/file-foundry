'use strict';

const fs = require('fs');
const path = require('path');
const { isBinaryBuffer } = require('../filesystem/detectBinary');
const { validateExtractorResult } = require('../extractors/validateExtractorResult');
const { sortCollectionRecords } = require('./sortCollectionRecords');

const fsp = fs.promises;

/** @param {string} sourceFile @param {object} definition @param {object} context */
async function resolveExtractCollection(sourceFile, definition, context) {
  const buffer = context.virtualFiles?.get(path.resolve(sourceFile)) || await fsp.readFile(sourceFile);
  if (isBinaryBuffer(buffer)) throw new Error(`Extract collection source is binary: ${sourceFile}.`);
  const extractor = context.extractorRegistry.get(definition.extract.type);
  const extension = path.extname(sourceFile).slice(1).toLowerCase();
  if (extractor.supportedExtensions && !extractor.supportedExtensions.includes(extension)) {
    throw new Error(`Extractor ${extractor.id} does not support .${extension} files.`);
  }
  context.log?.(
    `Extractor ${extractor.id} (${extractor.sourceType}${extractor.sourcePath ? `: ${extractor.sourcePath}` : ''}) reading ${sourceFile}`
  );
  const result = await extractor.extract({
    content: buffer.toString('utf8'), filePath: sourceFile,
    options: definition.extract.options || {}, context: context.safeContext
  });
  return sortCollectionRecords(validateExtractorResult(result, extractor.id), definition.sort);
}

module.exports = { resolveExtractCollection };
