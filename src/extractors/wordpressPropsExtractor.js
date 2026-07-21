'use strict';

/** Extract every safe prop name from each $props->admit_props([...]) call. */
async function wordpressPropsExtractor({ content }) {
  const callPattern = /\$props\s*->\s*admit_props\s*\(\s*\[\s*([\s\S]*?)\s*\]\s*\)/gu;
  const records = [];
  const seen = new Set();
  let callMatch;

  while ((callMatch = callPattern.exec(content)) !== null) {
    const propsSource = stripPhpComments(callMatch[1]);
    const stringPattern = /(['"])([A-Za-z_][A-Za-z0-9_]*)\1/gu;
    let propMatch;
    while ((propMatch = stringPattern.exec(propsSource)) !== null) {
      const name = propMatch[2];
      if (seen.has(name)) continue;
      seen.add(name);
      records.push({ name });
    }
  }

  return records;
}

function stripPhpComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\r\n]*/gu, '')
    .replace(/#[^\r\n]*/gu, '');
}

module.exports = { stripPhpComments, wordpressPropsExtractor };
