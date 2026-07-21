'use strict';

class ConditionSyntaxError extends Error {
  /** @param {string} message @param {number} offset */
  constructor(message, offset) {
    super(message);
    this.name = 'ConditionSyntaxError';
    this.offset = offset;
  }
}

/** @param {string} source */
function tokenizeCondition(source) {
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) { cursor += 1; continue; }
    const offset = cursor;
    const character = source[cursor];
    if (character === '(' || character === ')') {
      tokens.push({ type: character, value: character, offset });
      cursor += 1;
      continue;
    }
    const comparison = ['==', '!=', '>=', '<=', '>', '<'].find((operator) => source.startsWith(operator, cursor));
    if (comparison) {
      tokens.push({ type: 'comparison', value: comparison, offset });
      cursor += comparison.length;
      continue;
    }
    if (source.startsWith('&&', cursor) || source.startsWith('||', cursor) || character === '!') {
      throw new ConditionSyntaxError('Use the supported logical keywords not, and, and or instead of symbolic operators', offset);
    }
    if (character === '=') throw new ConditionSyntaxError('Unsupported operator =; use == for equality', offset);
    if (character === '"' || character === "'") {
      const quote = character;
      cursor += 1;
      let value = '';
      let closed = false;
      while (cursor < source.length) {
        const current = source[cursor];
        if (current === quote) { cursor += 1; closed = true; break; }
        if (current === '\\') {
          const escaped = source[cursor + 1];
          if (escaped !== quote && escaped !== '\\') {
            throw new ConditionSyntaxError(`Unsupported escape sequence \\${escaped || ''}`, cursor);
          }
          value += escaped;
          cursor += 2;
          continue;
        }
        value += current;
        cursor += 1;
      }
      if (!closed) throw new ConditionSyntaxError('Unclosed string literal', offset);
      tokens.push({ type: 'literal', value, offset });
      continue;
    }
    const number = /^-?(?:\d+(?:\.\d+)?)/u.exec(source.slice(cursor));
    if (number) {
      const end = cursor + number[0].length;
      if (end < source.length && /[A-Za-z0-9_.]/u.test(source[end])) {
        throw new ConditionSyntaxError(`Invalid number literal ${JSON.stringify(source.slice(cursor, end + 1))}`, offset);
      }
      tokens.push({ type: 'literal', value: Number(number[0]), offset });
      cursor = end;
      continue;
    }
    const word = /^[A-Za-z][A-Za-z0-9_:@.]*/u.exec(source.slice(cursor));
    if (word) {
      const value = word[0];
      if (value === 'true' || value === 'false') tokens.push({ type: 'literal', value: value === 'true', offset });
      else if (value === 'null') tokens.push({ type: 'literal', value: null, offset });
      else if (value === 'contains') tokens.push({ type: 'comparison', value, offset });
      else if (['not', 'and', 'or'].includes(value)) tokens.push({ type: value, value, offset });
      else tokens.push({ type: 'reference', value, offset });
      cursor += value.length;
      continue;
    }
    if (character === '`') throw new ConditionSyntaxError('Template literals are unsupported; use single or double quotes', offset);
    throw new ConditionSyntaxError(`Invalid token ${JSON.stringify(character)}`, offset);
  }
  tokens.push({ type: 'eof', value: '', offset: source.length });
  return tokens;
}

module.exports = { ConditionSyntaxError, tokenizeCondition };
