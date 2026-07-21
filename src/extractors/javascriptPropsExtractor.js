'use strict';

const path = require('path');
const babelParser = require('@babel/parser');

/** @param {{content: string, filePath: string, options?: object}} input */
async function javascriptPropsExtractor({ content, filePath, options = {} }) {
  if (options.component !== undefined && (typeof options.component !== 'string' || !options.component)) {
    throw new Error('fileFoundry.javascriptProps options.component must be a non-empty string.');
  }
  if (options.includeRest !== undefined && typeof options.includeRest !== 'boolean') {
    throw new Error('fileFoundry.javascriptProps options.includeRest must be a boolean.');
  }
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
    throw new Error(`fileFoundry.javascriptProps does not support .${extension || '<none>'} files.`);
  }
  let ast;
  try {
    ast = babelParser.parse(content, {
      sourceType: 'unambiguous',
      plugins: [extension === 'ts' || extension === 'tsx' ? 'typescript' : null, extension === 'jsx' || extension === 'tsx' ? 'jsx' : null].filter(Boolean)
    });
  } catch (error) {
    throw new Error(`Could not parse ${filePath}: ${error.message}`);
  }

  const components = new Map();
  let defaultComponent;
  for (const statement of ast.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      components.set(declaration.id.name, declaration);
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (const item of declaration.declarations) {
        if (item.id.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(item.init?.type)) {
          components.set(item.id.name, item.init);
        }
      }
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      if (statement.declaration.type === 'Identifier') {
        defaultComponent = statement.declaration.name;
      } else if (['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression'].includes(statement.declaration.type)) {
        if (statement.declaration.id) {
          components.set(statement.declaration.id.name, statement.declaration);
          defaultComponent = statement.declaration.id.name;
        } else {
          components.set('<default>', statement.declaration);
          defaultComponent = '<default>';
        }
      }
    }
  }
  const requested = options.component ?? 'defaultExport';
  const componentName = requested === 'defaultExport' ? defaultComponent : requested;
  const component = components.get(componentName);
  if (!component) {
    throw new Error(`Could not find component ${JSON.stringify(requested)} in ${filePath}.`);
  }
  return collectProps(component, content, options.includeRest === true);
}

/** @param {any} component @param {string} source @param {boolean} includeRest */
function collectProps(component, source, includeRest) {
  const records = [];
  const seen = new Set();
  const parameter = component.params?.[0];
  if (parameter?.type === 'ObjectPattern') {
    for (const property of parameter.properties) {
      if (property.type === 'RestElement') {
        if (includeRest && property.argument.type === 'Identifier') {
          add(property.argument.name, property.argument.name, false, '', true);
        }
        continue;
      }
      const externalName = property.computed
        ? property.key.type === 'StringLiteral' ? property.key.value : undefined
        : property.key.name ?? property.key.value;
      if (!externalName) continue;
      let value = property.value;
      let hasDefault = false;
      let defaultValue = '';
      if (value.type === 'AssignmentPattern') {
        hasDefault = true;
        defaultValue = source.slice(value.right.start, value.right.end);
        value = value.left;
      }
      add(externalName, value.name || externalName, hasDefault, defaultValue, false);
    }
  } else if (parameter?.type === 'Identifier') {
    const propsName = parameter.name;
    traverse(component.body, (node) => {
      if (node.type !== 'MemberExpression' || node.object?.type !== 'Identifier' || node.object.name !== propsName) return;
      const name = node.computed
        ? node.property.type === 'StringLiteral' ? node.property.value : undefined
        : node.property.type === 'Identifier' ? node.property.name : undefined;
      if (name) add(name, name, false, '', false);
    });
  }
  return records;

  function add(name, localName, hasDefault, defaultValue, isRest) {
    if (seen.has(name)) return;
    seen.add(name);
    records.push({ name, localName, hasDefault, defaultValue, isRest, sourceOrder: records.length });
  }
}

/** @param {any} node @param {(node: any) => void} visitor */
function traverse(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((item) => traverse(item, visitor));
    else if (value && typeof value === 'object' && typeof value.type === 'string') traverse(value, visitor);
  }
}

module.exports = { javascriptPropsExtractor };
