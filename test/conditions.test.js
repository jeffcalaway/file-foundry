'use strict';

const assert = require('assert').strict;
const { conditionTruthiness } = require('../src/conditions/conditionTruthiness');
const { compareValues, evaluateCondition } = require('../src/conditions/evaluateCondition');
const { parseCondition } = require('../src/conditions/parseCondition');
const { tokenizeCondition } = require('../src/conditions/tokenizeCondition');
const { test } = require('./harness');

function evaluate(source, values = {}) {
  return evaluateCondition(parseCondition(source), (reference) => {
    if (!Object.prototype.hasOwnProperty.call(values, reference)) throw new Error(`Unknown ${reference}`);
    return values[reference];
  });
}

test('condition literals support strings, escapes, numbers, booleans, and null', () => {
  assert.equal(evaluate('"button" == \'button\''), true);
  assert.equal(evaluate('"Jeff\\\"s" == \'Jeff"s\''), true);
  assert.equal(evaluate('"C:\\\\components" == \'C:\\\\components\''), true);
  assert.equal(evaluate('-2.25 < -1'), true);
  assert.equal(evaluate('3.5 >= 3.5'), true);
  assert.equal(evaluate('true != false'), true);
  assert.equal(evaluate('null == null'), true);
});

test('condition equality is type-strict and strings are case-sensitive', () => {
  assert.equal(evaluate('"1" == 1'), false);
  assert.equal(evaluate('true == "true"'), false);
  assert.equal(evaluate('"Button" == "button"'), false);
  assert.equal(evaluate('1 != 2'), true);
});

test('condition relational operators support numbers and strings without coercion', () => {
  assert.equal(evaluate('2 > 1'), true);
  assert.equal(evaluate('2 >= 2'), true);
  assert.equal(evaluate('1 < 2'), true);
  assert.equal(evaluate('1 <= 1'), true);
  assert.equal(evaluate('"b" > "a"'), true);
  assert.throws(() => evaluate('true > false'), /requires two numbers or two strings/);
  assert.throws(() => evaluate('1 > "0"'), /same type/);
  assert.throws(() => compareValues('==', [], 'x'), /collection.*scalar/);
});

test('contains supports string fragments and collection field projections', () => {
  assert.equal(evaluate('"primaryButton" contains "Button"'), true);
  assert.equal(evaluate('"primaryButton" contains "button"'), false);
  assert.equal(evaluate('Prompt:Names contains "Link"', { 'Prompt:Names': ['title', 'primaryLink'] }), true);
  assert.equal(evaluate('Prompt:Names contains "link"', { 'Prompt:Names': ['title', 'primaryLink'] }), false);
  assert.equal(evaluate('Prompt:Names contains "image"', { 'Prompt:Names': ['title', 'primaryLink'] }), false);
  assert.equal(evaluate('Prompt:Values contains 2', { 'Prompt:Values': [1, 2] }), true);
  assert.throws(() => evaluate('true contains "x"'), /requires a string and string, or a collection and scalar/);
});

test('logical keywords honor not, comparison, and, and or precedence', () => {
  const values = { 'Prompt:A': false, 'Prompt:B': true, 'Prompt:C': false };
  assert.equal(evaluate('Prompt:A or Prompt:B and Prompt:C', values), false);
  assert.equal(evaluate('(Prompt:A or Prompt:B) and not Prompt:C', values), true);
  assert.equal(evaluate('not (Prompt:A or Prompt:C)', values), true);
  assert.equal(evaluate('Prompt:B or Prompt:Missing', values), true);
});

test('condition truthiness follows File Foundry scalar, collection, and record rules', () => {
  for (const value of [false, null, 0, '', '   ', []]) assert.equal(conditionTruthiness(value), false);
  for (const value of [true, -1, 'x', 'false', [{}], {}]) assert.equal(conditionTruthiness(value), true);
});

test('condition parser rejects unsupported operators and malformed literals', () => {
  for (const [source, expected] of [
    ['!Prompt:A', /logical keywords/],
    ['Prompt:A && Prompt:B', /logical keywords/],
    ['Prompt:A || Prompt:B', /logical keywords/],
    ['Prompt:A = "x"', /use ==/],
    ['`button`', /Template literals/],
    ['"unterminated', /Unclosed string/],
    ['"bad\\n"', /Unsupported escape/],
    ['(true', /Unbalanced parentheses/],
    ['true)', /Unexpected token/],
    ['1 < 2 < 3', /Chained comparisons/],
    ['', /cannot be empty/]
  ]) assert.throws(() => parseCondition(source), expected);
});

test('condition tokenizer records useful source offsets', () => {
  const tokens = tokenizeCondition('Prompt:A and 2');
  assert.deepEqual(tokens.slice(0, 3).map((token) => [token.type, token.offset]), [
    ['reference', 0], ['and', 9], ['literal', 13]
  ]);
});
