'use strict';

const { applyTransform } = require('../placeholders/transforms');

/** @param {string} template @param {object} record @param {string} [alias] */
function renderRecordTemplate(template, record, alias = 'Item') {
  let cursor = 0;
  let output = '';
  const expression = new RegExp(`\\[\\[${alias}:([A-Za-z][A-Za-z0-9_]*)(?:>([A-Za-z][A-Za-z0-9]*))?\\]\\]`, 'gu');
  let match;
  while ((match = expression.exec(template)) !== null) {
    output += template.slice(cursor, match.index);
    if (!Object.prototype.hasOwnProperty.call(record, match[1])) throw new Error(`Collection record has no field ${JSON.stringify(match[1])}.`);
    const value = record[match[1]] === null ? '' : String(record[match[1]]);
    output += match[2] ? applyTransform(match[2], value) : value;
    cursor = match.index + match[0].length;
  }
  output += template.slice(cursor);
  if (output.includes('[[')) throw new Error(`Invalid or unresolved ${alias} option template: ${template}.`);
  return output;
}

module.exports = { renderRecordTemplate };
