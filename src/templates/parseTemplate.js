'use strict';

const { parseCondition } = require('../conditions/parseCondition');
const { parsePlaceholder } = require('../placeholders/parsePlaceholder');
const { LOOP_METADATA } = require('./resolveLoopValue');

/** @param {string} source @param {string} sourcePath @param {string} [blueprintName] */
function parseTemplate(source, sourcePath, blueprintName) {
  const root = { type: 'root', children: [] };
  const stack = [{ kind: 'root', node: root }];
  const promptKeys = new Set();
  const collectionKeys = new Set();
  const placeholderMatches = [];
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf('[[', cursor);
    if (opening === -1) { addNode({ type: 'text', value: source.slice(cursor) }); break; }
    const closing = source.indexOf(']]', opening + 2);
    const location = sourceLocation(source, opening);
    if (closing === -1) throw templateError('Missing closing brackets', sourcePath, location, blueprintName);
    const raw = source.slice(opening, closing + 2);
    const inner = raw.slice(2, -2);
    const each = /^#each (Collection|Prompt):([A-Za-z][A-Za-z0-9_]*) as ([A-Za-z][A-Za-z0-9_]*)$/u.exec(inner);
    const ifDirective = /^#if(?:\s+(.*))?$/u.exec(inner);
    const elseifDirective = /^#elseif(?:\s+(.*))?$/u.exec(inner);
    const controlDirective = Boolean(each || inner === '/each' || ifDirective || elseifDirective || inner === '#else' || inner === '/if');
    const standalone = controlDirective ? findStandaloneDirective(source, opening, closing + 2) : undefined;
    const textEnd = standalone ? standalone.lineStart : opening;
    if (textEnd > cursor) addNode({ type: 'text', value: source.slice(cursor, textEnd) });

    if (each) {
      const [, sourceType, sourceKey, alias] = each;
      if (activeAliases().has(alias)) throw templateError(`Nested loop reuses active alias ${alias}`, sourcePath, location, blueprintName, raw);
      const node = { type: 'each', sourceType, sourceKey, alias, children: [], location };
      addNode(node);
      if (sourceType === 'Collection') collectionKeys.add(sourceKey); else promptKeys.add(sourceKey);
      stack.push({ kind: 'each', node, alias });
    } else if (inner === '/each') {
      if (top().kind !== 'each') throw templateError('Unexpected [[/each]]', sourcePath, location, blueprintName, raw);
      stack.pop();
    } else if (inner.startsWith('#each') || inner.startsWith('/each')) {
      throw templateError(`Malformed loop directive ${raw}`, sourcePath, location, blueprintName, raw);
    } else if (ifDirective) {
      const expression = ifDirective[1] || '';
      const branch = createConditionalBranch(expression, raw, location);
      const node = { type: 'conditional', branches: [branch], location, sawElse: false };
      addNode(node);
      stack.push({ kind: 'conditional', node, branch });
    } else if (elseifDirective) {
      if (top().kind !== 'conditional') throw templateError('[[#elseif]] appears outside an #if block', sourcePath, location, blueprintName, raw);
      if (top().node.sawElse) throw templateError('[[#elseif]] cannot appear after [[#else]]', sourcePath, location, blueprintName, raw);
      const expression = elseifDirective[1] || '';
      const branch = createConditionalBranch(expression, raw, location);
      top().node.branches.push(branch);
      top().branch = branch;
    } else if (inner === '#else') {
      if (top().kind !== 'conditional') throw templateError('[[#else]] appears outside an #if block', sourcePath, location, blueprintName, raw);
      if (top().node.sawElse) throw templateError('An #if block may contain at most one [[#else]]', sourcePath, location, blueprintName, raw);
      const branch = { condition: null, expression: null, children: [], location, raw };
      top().node.sawElse = true;
      top().node.branches.push(branch);
      top().branch = branch;
    } else if (inner.startsWith('#else')) {
      throw templateError('[[#else]] must not include an expression', sourcePath, location, blueprintName, raw);
    } else if (inner === '/if') {
      if (top().kind !== 'conditional') throw templateError('Unexpected [[/if]]', sourcePath, location, blueprintName, raw);
      delete top().node.sawElse;
      stack.pop();
    } else if (inner.startsWith('#') || inner.startsWith('/')) {
      throw templateError(`Unsupported or malformed template directive ${raw}`, sourcePath, location, blueprintName, raw);
    } else {
      addExpression(raw, inner, location);
    }
    cursor = standalone ? standalone.nextCursor : closing + 2;
  }
  if (stack.length > 1) {
    const frame = top();
    const message = frame.kind === 'each'
      ? `Missing [[/each]] for alias ${frame.alias}`
      : 'Missing [[/if]] for conditional block';
    throw templateError(message, sourcePath, frame.node.location, blueprintName);
  }
  return { root, promptKeys: [...promptKeys], collectionKeys: [...collectionKeys], placeholderMatches, sourcePath, blueprintName };

  function top() { return stack[stack.length - 1]; }
  function currentChildren() { return top().kind === 'conditional' ? top().branch.children : top().node.children; }
  function addNode(node) { currentChildren().push(node); }
  function activeAliases() { return new Set(stack.filter((frame) => frame.kind === 'each').map((frame) => frame.alias)); }

  function createConditionalBranch(expression, raw, location) {
    if (!expression.trim()) throw templateError('Conditional expression cannot be empty', sourcePath, location, blueprintName, raw);
    try {
      return { condition: parseCondition(expression), expression, children: [], location, raw };
    } catch (error) {
      const expressionOffset = raw.indexOf(expression);
      const adjusted = {
        line: location.line,
        column: location.column + expressionOffset + (error.offset || 0),
        offset: location.offset + expressionOffset + (error.offset || 0)
      };
      throw templateError(`Invalid condition ${JSON.stringify(expression)}: ${error.message}`, sourcePath, adjusted, blueprintName, raw);
    }
  }

  function addExpression(raw, inner, location) {
    const aliasMatch = /^([A-Za-z][A-Za-z0-9_]*):(@?[A-Za-z][A-Za-z0-9_]*)(?:>([A-Za-z][A-Za-z0-9]*))?$/u.exec(inner);
    if (aliasMatch && activeAliases().has(aliasMatch[1])) {
      if (aliasMatch[2].startsWith('@') && aliasMatch[3]) {
        throw templateError('Loop metadata cannot use transformations', sourcePath, location, blueprintName, raw);
      }
      if (aliasMatch[2].startsWith('@') && !LOOP_METADATA.includes(aliasMatch[2])) {
        throw templateError(`Unknown loop metadata ${aliasMatch[2]}`, sourcePath, location, blueprintName, raw);
      }
      addNode({ type: 'alias', alias: aliasMatch[1], field: aliasMatch[2], transform: aliasMatch[3], raw, location });
      return;
    }
    try {
      const parsed = parsePlaceholder(raw);
      addNode({ type: 'expression', raw, parsed, location });
      if (!stack.some((frame) => frame.kind === 'conditional')) placeholderMatches.push({ parsed });
    } catch (error) {
      if (!stack.some((frame) => frame.kind === 'conditional')) {
        if (aliasMatch) throw templateError(`Alias ${aliasMatch[1]} is used outside its loop scope`, sourcePath, location, blueprintName, raw);
        throw templateError(error.message, sourcePath, location, blueprintName, raw);
      }
      addNode({ type: 'expression', raw, parseError: error.message, aliasMatch, location });
    }
  }
}

/**
 * A block directive containing no other content on its physical line is a
 * control line. Remove its indentation and one line ending.
 * @param {string} source @param {number} opening @param {number} directiveEnd
 */
function findStandaloneDirective(source, opening, directiveEnd) {
  const previousNewline = Math.max(source.lastIndexOf('\n', opening - 1), source.lastIndexOf('\r', opening - 1));
  const lineStart = previousNewline + 1;
  if (!/^[\t ]*$/u.test(source.slice(lineStart, opening))) return undefined;
  let nextCursor = directiveEnd;
  while (source[nextCursor] === ' ' || source[nextCursor] === '\t') nextCursor += 1;
  if (nextCursor === source.length) return { lineStart, nextCursor };
  if (source[nextCursor] === '\r') {
    nextCursor += source[nextCursor + 1] === '\n' ? 2 : 1;
    return { lineStart, nextCursor };
  }
  if (source[nextCursor] === '\n') return { lineStart, nextCursor: nextCursor + 1 };
  return undefined;
}

/** @param {string} source @param {number} offset */
function sourceLocation(source, offset) {
  const before = source.slice(0, offset);
  const line = before.split(/\r\n|\r|\n/u).length;
  const lastNewline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
  return { line, column: offset - lastNewline, offset };
}

/** @param {string} message @param {string} sourcePath @param {object} location @param {string} [blueprintName] @param {string} [directive] */
function templateError(message, sourcePath, location, blueprintName, directive) {
  const prefix = blueprintName ? `Blueprint “${blueprintName}”, ` : '';
  const suffix = directive ? ` Directive: ${directive}.` : '';
  return new Error(`${prefix}source ${sourcePath}:${location.line}:${location.column}: ${message}.${suffix}`);
}

module.exports = { findStandaloneDirective, parseTemplate, sourceLocation, templateError };
