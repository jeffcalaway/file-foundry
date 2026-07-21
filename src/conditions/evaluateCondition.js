'use strict';

const { conditionTruthiness } = require('./conditionTruthiness');

/** @param {object} ast @param {(reference: string) => unknown} resolveReference */
function evaluateCondition(ast, resolveReference) {
  return conditionTruthiness(evaluateValue(ast, resolveReference));
}

/** @param {object} node @param {(reference: string) => unknown} resolveReference */
function evaluateValue(node, resolveReference) {
  if (node.type === 'literal') return node.value;
  if (node.type === 'reference') return resolveReference(node.value);
  if (node.type === 'not') return !conditionTruthiness(evaluateValue(node.operand, resolveReference));
  if (node.type === 'logical') {
    const left = conditionTruthiness(evaluateValue(node.left, resolveReference));
    if (node.operator === 'and') return left ? conditionTruthiness(evaluateValue(node.right, resolveReference)) : false;
    return left ? true : conditionTruthiness(evaluateValue(node.right, resolveReference));
  }
  if (node.type === 'comparison') {
    const left = evaluateValue(node.left, resolveReference);
    const right = evaluateValue(node.right, resolveReference);
    return compareValues(node.operator, left, right);
  }
  throw new Error(`Unknown condition AST node ${JSON.stringify(node.type)}.`);
}

/** @param {string} operator @param {unknown} left @param {unknown} right */
function compareValues(operator, left, right) {
  const leftCollection = Array.isArray(left);
  const rightCollection = Array.isArray(right);
  const leftRecord = left !== null && typeof left === 'object' && !leftCollection;
  const rightRecord = right !== null && typeof right === 'object' && !rightCollection;
  if (operator === 'contains') {
    if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
    if (leftCollection && !rightCollection && !rightRecord) {
      return left.some((value) => typeof value === 'string' && typeof right === 'string'
        ? value.includes(right)
        : value === right);
    }
    throw new Error('Operator contains requires a string and string, or a collection and scalar value.');
  }
  if ((leftCollection || rightCollection) && leftCollection !== rightCollection) {
    throw new Error('A collection cannot be compared directly to a scalar value. Use it as a truthy check instead.');
  }
  if ((leftRecord || rightRecord) && leftRecord !== rightRecord) {
    throw new Error('A record cannot be compared directly to a scalar value. Compare one of its fields instead.');
  }
  if (operator === '==') return left === right;
  if (operator === '!=') return left !== right;
  if (!['number', 'string'].includes(typeof left) || typeof left !== typeof right) {
    throw new Error(`Operator ${operator} requires two numbers or two strings of the same type.`);
  }
  if (operator === '>') return left > right;
  if (operator === '>=') return left >= right;
  if (operator === '<') return left < right;
  return left <= right;
}

module.exports = { compareValues, evaluateCondition, evaluateValue };
