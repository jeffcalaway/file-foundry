'use strict';

const { resolveCollectionSource } = require('./resolveCollectionSource');
const { resolveExtractCollection } = require('./resolveExtractCollection');
const { resolveFilesystemCollection } = require('./resolveFilesystemCollection');

/** @param {string[]} names @param {Record<string, object>} definitions @param {object} context */
async function resolveCollections(names, definitions, context) {
  const resolved = {};
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(resolved, name)) continue;
    const definition = definitions[name];
    if (!definition) throw new Error(`Unknown collection ${JSON.stringify(name)}.`);
    const expected = definition.type === 'filesystem' ? 'directory' : 'file';
    let source;
    let discovered = [];
    try {
      source = await resolveCollectionSource(definition.source, context, expected);
      context.log?.(`Collection ${name} (${definition.type}) source: ${source}`);
      discovered = definition.type === 'filesystem'
        ? await resolveFilesystemCollection(source, definition, context)
        : await resolveExtractCollection(source, definition, context);
    } catch (error) {
      if (definition.onMissing !== 'empty' || !error.message.startsWith('Collection source is unavailable:')) throw error;
      context.log?.(`Collection ${name}: source is unavailable; continuing with initial records.`);
    }
    const records = combineInitialRecords(definition.initialRecords, discovered, definition.uniqueBy);
    context.log?.(
      `Collection ${name}: ${records.length} record(s); include=${JSON.stringify(definition.include || [])}; ` +
      `exclude=${JSON.stringify(definition.exclude || [])}; onEmpty=${definition.onEmpty}`
    );
    if (records.length === 0) {
      if (definition.onEmpty === 'error') throw new Error(`Collection ${JSON.stringify(name)} is empty.`);
      if (definition.onEmpty === 'warn') context.log?.(`Warning: collection ${name} is empty.`);
    }
    resolved[name] = records;
  }
  return resolved;
}

function combineInitialRecords(initialRecords = [], discovered = [], uniqueBy) {
  const combined = [...initialRecords.map((record) => ({ ...record })), ...discovered];
  if (!uniqueBy) return combined;
  const seen = new Set();
  return combined.filter((record) => {
    const value = record[uniqueBy];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

module.exports = { combineInitialRecords, resolveCollections };
