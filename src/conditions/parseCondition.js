'use strict';

const { ConditionSyntaxError, tokenizeCondition } = require('./tokenizeCondition');

/** @param {string} source */
function parseCondition(source) {
  if (typeof source !== 'string' || !source.trim()) throw new ConditionSyntaxError('Conditional expression cannot be empty', 0);
  const tokens = tokenizeCondition(source);
  let cursor = 0;
  const ast = parseOr();
  if (current().type !== 'eof') throw new ConditionSyntaxError(`Unexpected token ${JSON.stringify(current().value)}`, current().offset);
  return ast;

  function current() { return tokens[cursor]; }
  function consume(type) {
    if (current().type !== type) throw new ConditionSyntaxError(`Expected ${type} but found ${JSON.stringify(current().value)}`, current().offset);
    return tokens[cursor++];
  }
  function parseOr() {
    let node = parseAnd();
    while (current().type === 'or') { const operator = consume('or'); node = { type: 'logical', operator: 'or', left: node, right: parseAnd(), offset: operator.offset }; }
    return node;
  }
  function parseAnd() {
    let node = parseComparison();
    while (current().type === 'and') { const operator = consume('and'); node = { type: 'logical', operator: 'and', left: node, right: parseComparison(), offset: operator.offset }; }
    return node;
  }
  function parseComparison() {
    let node = parseNot();
    if (current().type === 'comparison') {
      const operator = consume('comparison');
      node = { type: 'comparison', operator: operator.value, left: node, right: parseNot(), offset: operator.offset };
      if (current().type === 'comparison') throw new ConditionSyntaxError('Chained comparisons are unsupported', current().offset);
    }
    return node;
  }
  function parseNot() {
    if (current().type === 'not') { const token = consume('not'); return { type: 'not', operand: parseNot(), offset: token.offset }; }
    return parsePrimary();
  }
  function parsePrimary() {
    if (current().type === 'literal') { const token = consume('literal'); return { type: 'literal', value: token.value, offset: token.offset }; }
    if (current().type === 'reference') {
      const token = consume('reference');
      validateReference(token.value, token.offset);
      return { type: 'reference', value: token.value, offset: token.offset };
    }
    if (current().type === '(') {
      const opening = consume('(');
      const node = parseOr();
      if (current().type !== ')') throw new ConditionSyntaxError('Unbalanced parentheses; missing )', opening.offset);
      consume(')');
      return node;
    }
    throw new ConditionSyntaxError(`Expected a value but found ${JSON.stringify(current().value)}`, current().offset);
  }
}

/** @param {string} value @param {number} offset */
function validateReference(value, offset) {
  const plain = /^[A-Za-z][A-Za-z0-9_]*$/u;
  const namespaced = /^(?:Collection|Custom|Output):[A-Za-z][A-Za-z0-9_]*$/u;
  const prompt = /^Prompt:[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/u;
  const alias = /^[A-Za-z][A-Za-z0-9_]*:(?:[A-Za-z][A-Za-z0-9_]*|@(index|number|first|last|count))$/u;
  if (!plain.test(value) && !namespaced.test(value) && !prompt.test(value) && !alias.test(value)) {
    throw new ConditionSyntaxError(`Invalid value reference ${JSON.stringify(value)}`, offset);
  }
}

module.exports = { parseCondition, validateReference };
