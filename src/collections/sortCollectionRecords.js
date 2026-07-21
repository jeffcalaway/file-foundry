'use strict';

/** @param {object[]} records @param {object} sort */
function sortCollectionRecords(records, sort) {
  if (!sort || sort.by === 'source') return [...records];
  const collator = new Intl.Collator(undefined, {
    sensitivity: sort.caseSensitive ? 'variant' : 'base',
    numeric: sort.numeric !== false
  });
  return records.map((record, index) => ({ record, index })).sort((left, right) => {
    const a = left.record[sort.by];
    const b = right.record[sort.by];
    const comparison = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a ?? ''), String(b ?? ''));
    return (sort.direction === 'descending' ? -comparison : comparison) || left.index - right.index;
  }).map((entry) => entry.record);
}

module.exports = { sortCollectionRecords };
