'use strict';

const {
  COLLECTION_SCOPES,
  COLLECTION_TYPES,
  EMPTY_BEHAVIORS,
  IDENTIFIER_PATTERN,
  PATH_FORMATS,
  PROMPT_TYPES,
  SUPPORTED_MANIFEST_VERSION,
  TOP_LEVEL_PROPERTIES
} = require('./manifestConstants');
const { scanPlaceholders } = require('../placeholders/scanPlaceholders');
const minimatch = require('minimatch');

/**
 * @param {unknown} manifestValue
 * @param {string} blueprintName
 * @returns {{warnings: string[]}}
 */
function validateBlueprintManifest(manifestValue, blueprintName) {
  if (!isObject(manifestValue)) {
    throw manifestError(blueprintName, 'The manifest root must be a JSON object.');
  }
  const manifest = manifestValue;
  rejectManifestBlocks(manifest, blueprintName);
  if (!Object.prototype.hasOwnProperty.call(manifest, 'version')) {
    throw manifestError(blueprintName, 'The required "version" property is missing.');
  }
  if (manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    throw manifestError(blueprintName, `Unsupported manifest version ${JSON.stringify(manifest.version)}. Supported version: 1.`);
  }

  const warnings = Object.keys(manifest)
    .filter((key) => !TOP_LEVEL_PROPERTIES.includes(key))
    .map((key) => `Blueprint “${blueprintName}” manifest contains unknown top-level property ${JSON.stringify(key)}.`);

  optionalString(manifest, 'name', blueprintName);
  optionalString(manifest, 'description', blueprintName);
  optionalBoolean(manifest, 'omitEmptyFiles', blueprintName);

  const placeholders = manifest.placeholders ?? {};
  if (!isObject(placeholders)) {
    throw manifestError(blueprintName, '"placeholders" must be an object.');
  }
  for (const [key, definition] of Object.entries(placeholders)) {
    identifier(key, `custom placeholder key`, blueprintName);
    if (!isObject(definition) || typeof definition.value !== 'string') {
      throw manifestError(blueprintName, `Custom placeholder ${JSON.stringify(key)} must be an object with a string "value".`);
    }
  }

  const prompts = manifest.prompts ?? [];
  if (!Array.isArray(prompts)) {
    throw manifestError(blueprintName, '"prompts" must be an array.');
  }
  const promptKeys = new Set();
  const collections = manifest.collections ?? {};
  validateCollections(collections, placeholders, blueprintName);
  for (const [index, prompt] of prompts.entries()) {
    validatePrompt(prompt, index, blueprintName, collections);
    if (promptKeys.has(prompt.key)) {
      throw manifestError(blueprintName, `Duplicate prompt key ${JSON.stringify(prompt.key)}.`);
    }
    if (Object.prototype.hasOwnProperty.call(placeholders, prompt.key)) {
      throw manifestError(blueprintName, `Key ${JSON.stringify(prompt.key)} is used by both a custom placeholder and a prompt.`);
    }
    promptKeys.add(prompt.key);
  }

  validateCollectionDependencyGraph(collections, placeholders, prompts, blueprintName);
  validateCustomDependencies(placeholders, promptKeys, blueprintName);
  validateFileSelection(manifest.fileSelection, blueprintName);
  validateFormatters(manifest.formatters, blueprintName);
  validateWorkspaceEdits(manifest.workspaceEdits, prompts, manifest.fileSelection, blueprintName);
  validateOutputRoutes(manifest.outputRoutes, manifest.fileSelection, blueprintName);
  return { warnings };
}

function validateOutputRoutes(routes, fileSelection, blueprintName) {
  if (routes === undefined) return;
  if (!Array.isArray(routes)) throw manifestError(blueprintName, '"outputRoutes" must be an array.');
  const options = Object.fromEntries((fileSelection?.options || []).map((option) => [option.key, option]));
  const routedSources = new Set();
  for (const [index, route] of routes.entries()) {
    const location = `outputRoutes[${index}]`;
    if (!isObject(route) || route.type !== 'wordpressTemplateBlock') {
      throw manifestError(blueprintName, `${location}.type must be wordpressTemplateBlock.`);
    }
    const option = route.option ?? 'templateBlock';
    identifier(option, `${location}.option`, blueprintName);
    if (!options[option]) {
      throw manifestError(blueprintName, `${location}.option references undefined file-selection option ${JSON.stringify(option)}.`);
    }
    for (const property of ['legacySource', 'modernSource']) {
      const source = route[property];
      if (typeof source !== 'string' || !source || pathIsUnsafe(source)) {
        throw manifestError(blueprintName, `${location}.${property} must be a safe non-empty blueprint-relative path.`);
      }
      if (!options[option].files.includes(source)) {
        throw manifestError(blueprintName, `${location}.${property} must be a literal file in option ${JSON.stringify(option)}.`);
      }
      if (routedSources.has(source)) {
        throw manifestError(blueprintName, `${location}.${property} is routed more than once.`);
      }
      routedSources.add(source);
    }
  }
}

function pathIsUnsafe(value) {
  const portable = value.replace(/\\/gu, '/');
  return portable.startsWith('/') || /^[A-Za-z]:\//u.test(portable) || portable.split('/').includes('..');
}

function validateFormatters(formatters, blueprintName) {
  if (formatters === undefined) return;
  if (!Array.isArray(formatters)) throw manifestError(blueprintName, '"formatters" must be an array.');
  for (const [index, formatter] of formatters.entries()) {
    const location = `formatters[${index}]`;
    if (!isObject(formatter) || !['alignAssignments', 'alignPhpOperators'].includes(formatter.type)) {
      throw manifestError(blueprintName, `${location}.type must be alignAssignments or alignPhpOperators.`);
    }
    if (!Array.isArray(formatter.sourceFiles) || formatter.sourceFiles.length === 0 ||
        formatter.sourceFiles.some((file) => typeof file !== 'string' || !file)) {
      throw manifestError(blueprintName, `${location}.sourceFiles must be a non-empty array of source path strings.`);
    }
  }
}

function validateWorkspaceEdits(edits, prompts, fileSelection, blueprintName) {
  if (edits === undefined) return;
  if (!Array.isArray(edits)) throw manifestError(blueprintName, '"workspaceEdits" must be an array.');
  const promptKeys = new Set(prompts.map((prompt) => prompt.key));
  const outputKeys = new Set((fileSelection?.options || []).map((option) => option.key));
  const types = new Set();
  for (const [index, edit] of edits.entries()) {
    const location = `workspaceEdits[${index}]`;
    if (!isObject(edit) || edit.type !== 'usefulGroupPhpRegistry') {
      throw manifestError(blueprintName, `${location}.type must be usefulGroupPhpRegistry.`);
    }
    if (types.has(edit.type)) throw manifestError(blueprintName, `${location}.type is duplicated.`);
    types.add(edit.type);
    const moduleNamePrompt = edit.moduleNamePrompt ?? 'ModuleName';
    const parentModuleOption = edit.parentModuleOption ?? 'parentModule';
    const functionsOption = edit.functionsOption ?? 'functions';
    for (const [property, value] of Object.entries({ moduleNamePrompt, parentModuleOption, functionsOption })) {
      identifier(value, `${location}.${property}`, blueprintName);
    }
    if (!promptKeys.has(moduleNamePrompt)) {
      throw manifestError(blueprintName, `${location}.moduleNamePrompt references undefined prompt ${JSON.stringify(moduleNamePrompt)}.`);
    }
    for (const [property, value] of Object.entries({ parentModuleOption, functionsOption })) {
      if (!outputKeys.has(value)) {
        throw manifestError(blueprintName, `${location}.${property} references undefined file-selection option ${JSON.stringify(value)}.`);
      }
    }
  }
}

/** @param {any} prompt @param {number} index @param {string} blueprintName */
function validatePrompt(prompt, index, blueprintName, collections = {}) {
  const location = `prompts[${index}]`;
  if (!isObject(prompt)) {
    throw manifestError(blueprintName, `${location} must be an object.`);
  }
  identifier(prompt.key, `${location}.key`, blueprintName);
  if (!PROMPT_TYPES.includes(prompt.type)) {
    throw manifestError(blueprintName, `${location}.type must be one of: ${PROMPT_TYPES.join(', ')}.`);
  }
  for (const property of ['title', 'prompt']) {
    optionalString(prompt, property, blueprintName, location);
  }

  if (prompt.type === 'selectFromCollection') {
    validateCollectionPrompt(prompt, blueprintName, location, collections);
  } else if (prompt.type === 'input') {
    for (const property of ['placeholder', 'default']) {
      optionalString(prompt, property, blueprintName, location);
    }
    optionalBoolean(prompt, 'required', blueprintName, location);
    optionalBoolean(prompt, 'password', blueprintName, location);
    validateInputDefault(prompt.default, blueprintName, location);
    validateInputValidation(prompt.validation, blueprintName, location);
    validateInputAutoValue(prompt.autoValue, blueprintName, location);
  } else if (prompt.type === 'pick' || prompt.type === 'multiPick') {
    validateOptions(prompt.options, blueprintName, location);
    if (prompt.type === 'pick') {
      if (prompt.default !== undefined && typeof prompt.default !== 'string') {
        throw manifestError(blueprintName, `${location}.default must be an option value string.`);
      }
      validateOptionDefaults(prompt.default === undefined ? [] : [prompt.default], prompt.options, blueprintName, location);
    } else {
      if (prompt.default !== undefined && !Array.isArray(prompt.default)) {
        throw manifestError(blueprintName, `${location}.default must be an array of option values.`);
      }
      validateOptionDefaults(prompt.default || [], prompt.options, blueprintName, location);
      optionalString(prompt, 'separator', blueprintName, location);
      optionalBoolean(prompt, 'required', blueprintName, location);
    }
  } else if (prompt.type === 'confirm') {
    optionalBoolean(prompt, 'default', blueprintName, location);
    for (const property of ['trueLabel', 'falseLabel', 'trueValue', 'falseValue']) {
      optionalString(prompt, property, blueprintName, location);
    }
  } else {
    if (prompt.pathFormat !== undefined && !PATH_FORMATS.includes(prompt.pathFormat)) {
      throw manifestError(blueprintName, `${location}.pathFormat must be one of: ${PATH_FORMATS.join(', ')}.`);
    }
    if (prompt.type === 'file' && prompt.filters !== undefined) {
      if (!isObject(prompt.filters) || Object.values(prompt.filters).some((extensions) =>
        !Array.isArray(extensions) || extensions.some((extension) => typeof extension !== 'string')
      )) {
        throw manifestError(blueprintName, `${location}.filters must map labels to arrays of file extensions.`);
      }
    }
  }
}

function validateInputAutoValue(autoValue, blueprintName, location) {
  if (autoValue === undefined) return;
  if (!isObject(autoValue) || autoValue.type !== 'usefulGroupPhpNamespace') {
    throw manifestError(blueprintName, `${location}.autoValue.type must be usefulGroupPhpNamespace.`);
  }
}

/** @param {unknown} value @param {string} blueprintName @param {string} location */
function validateInputDefault(value, blueprintName, location) {
  if (value === undefined) {
    return;
  }
  for (const match of scanPlaceholders(value, `blueprint.json ${location}.default`)) {
    if (match.parsed.namespace !== 'BuiltIn') {
      throw manifestError(blueprintName, `${location}.default may reference built-in placeholders only.`);
    }
  }
}

/** @param {any} validation @param {string} blueprintName @param {string} location */
function validateInputValidation(validation, blueprintName, location) {
  if (validation === undefined) {
    return;
  }
  if (!isObject(validation) || typeof validation.pattern !== 'string') {
    throw manifestError(blueprintName, `${location}.validation must contain a string "pattern".`);
  }
  optionalString(validation, 'message', blueprintName, `${location}.validation`);
  try {
    new RegExp(validation.pattern);
  } catch (error) {
    throw manifestError(blueprintName, `${location}.validation.pattern is not a valid regular expression: ${error.message}`);
  }
}

/** @param {any} options @param {string} blueprintName @param {string} location */
function validateOptions(options, blueprintName, location) {
  if (!Array.isArray(options) || options.length === 0) {
    throw manifestError(blueprintName, `${location}.options must be a non-empty array.`);
  }
  const values = new Set();
  for (const [index, option] of options.entries()) {
    if (!isObject(option) || typeof option.label !== 'string' || typeof option.value !== 'string') {
      throw manifestError(blueprintName, `${location}.options[${index}] requires string "label" and "value" properties.`);
    }
    for (const property of ['description', 'detail']) {
      optionalString(option, property, blueprintName, `${location}.options[${index}]`);
    }
    validateOptionIconPath(option.iconPath, blueprintName, `${location}.options[${index}].iconPath`);
    if (values.has(option.value)) {
      throw manifestError(blueprintName, `${location} contains duplicate option value ${JSON.stringify(option.value)}.`);
    }
    values.add(option.value);
  }
}

/** @param {unknown} iconPath @param {string} blueprintName @param {string} location */
function validateOptionIconPath(iconPath, blueprintName, location) {
  if (iconPath === undefined) return;
  if (typeof iconPath === 'string') {
    validateRelativeAssetPath(iconPath, blueprintName, location);
    return;
  }
  if (!isObject(iconPath) || typeof iconPath.light !== 'string' || typeof iconPath.dark !== 'string') {
    throw manifestError(blueprintName, `${location} must be a relative path string or an object with string "light" and "dark" paths.`);
  }
  validateRelativeAssetPath(iconPath.light, blueprintName, `${location}.light`);
  validateRelativeAssetPath(iconPath.dark, blueprintName, `${location}.dark`);
}

/** @param {string} value @param {string} blueprintName @param {string} location */
function validateRelativeAssetPath(value, blueprintName, location) {
  const portable = value.replace(/\\/gu, '/');
  if (!portable || portable.startsWith('/') || /^[A-Za-z]:\//u.test(portable) || portable.split('/').includes('..') || portable.includes('[[')) {
    throw manifestError(blueprintName, `${location} must be a safe relative path without placeholders.`);
  }
}

/** @param {string[]} defaults @param {any[]} options @param {string} blueprintName @param {string} location */
function validateOptionDefaults(defaults, options, blueprintName, location) {
  const values = new Set(options.map((option) => option.value));
  for (const value of defaults) {
    if (typeof value !== 'string' || !values.has(value)) {
      throw manifestError(blueprintName, `${location}.default contains undeclared option value ${JSON.stringify(value)}.`);
    }
  }
}

/** @param {Record<string, any>} placeholders @param {Set<string>} promptKeys @param {string} blueprintName */
function validateCustomDependencies(placeholders, promptKeys, blueprintName) {
  const graph = new Map();
  for (const [key, definition] of Object.entries(placeholders)) {
    const dependencies = [];
    for (const match of scanPlaceholders(definition.value, `blueprint.json placeholders.${key}.value`)) {
      const parsed = match.parsed;
      if (parsed.namespace === 'Custom') {
        if (!Object.prototype.hasOwnProperty.call(placeholders, parsed.key)) {
          throw manifestError(blueprintName, `Custom placeholder ${JSON.stringify(key)} references undefined custom placeholder ${JSON.stringify(parsed.key)}.`);
        }
        dependencies.push(parsed.key);
      } else if (parsed.namespace === 'Prompt' && !promptKeys.has(parsed.key)) {
        throw manifestError(blueprintName, `Custom placeholder ${JSON.stringify(key)} references undefined prompt ${JSON.stringify(parsed.key)}.`);
      }
    }
    graph.set(key, dependencies);
  }

  const complete = new Set();
  const active = [];
  function visit(key) {
    if (active.includes(key)) {
      const cycleStart = active.indexOf(key);
      const chain = [...active.slice(cycleStart), key].join(' → ');
      throw manifestError(blueprintName, `Circular custom placeholder dependency: ${chain}.`);
    }
    if (complete.has(key)) {
      return;
    }
    active.push(key);
    for (const dependency of graph.get(key) || []) {
      visit(dependency);
    }
    active.pop();
    complete.add(key);
  }
  for (const key of graph.keys()) {
    visit(key);
  }
}

/** @param {any} collections @param {Record<string, any>} placeholders @param {string} blueprintName */
function validateCollections(collections, placeholders, blueprintName) {
  if (!isObject(collections)) {
    throw manifestError(blueprintName, '"collections" must be an object.');
  }
  for (const [name, collection] of Object.entries(collections)) {
    identifier(name, 'collection name', blueprintName);
    const collectionType = collection?.type ?? 'filesystem';
    if (!isObject(collection) || !COLLECTION_TYPES.includes(collectionType)) {
      throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} must have type filesystem or extract.`);
    }
    validateCollectionSource(collection.source, name, placeholders, blueprintName);
    if (collection.onEmpty !== undefined && !EMPTY_BEHAVIORS.includes(collection.onEmpty)) {
      throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} has invalid onEmpty value ${JSON.stringify(collection.onEmpty)}.`);
    }
    if (collection.onMissing !== undefined && !['error', 'empty'].includes(collection.onMissing)) {
      throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} has invalid onMissing value ${JSON.stringify(collection.onMissing)}.`);
    }
    if (collection.initialRecords !== undefined &&
        (!Array.isArray(collection.initialRecords) || collection.initialRecords.some((record) =>
          !isObject(record) || Object.values(record).some((value) => !['string', 'number', 'boolean'].includes(typeof value) && value !== null)
        ))) {
      throw manifestError(blueprintName, `collections.${name}.initialRecords must be an array of flat scalar records.`);
    }
    if (collection.uniqueBy !== undefined) {
      identifier(collection.uniqueBy, `collections.${name}.uniqueBy`, blueprintName);
      if ((collection.initialRecords || []).some((record) => !Object.prototype.hasOwnProperty.call(record, collection.uniqueBy))) {
        throw manifestError(blueprintName, `collections.${name}.initialRecords must contain uniqueBy field ${JSON.stringify(collection.uniqueBy)}.`);
      }
    }
    validateCollectionSort(collection.sort, collectionType, name, blueprintName);
    if (collectionType === 'filesystem') {
      if (collection.kind !== undefined && !['file', 'folder', 'any'].includes(collection.kind)) {
        throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} has invalid kind ${JSON.stringify(collection.kind)}.`);
      }
      for (const property of ['recursive', 'includeHidden', 'followSymlinks']) {
        optionalBoolean(collection, property, blueprintName, `collections.${name}`);
      }
      if (collection.maxDepth !== undefined && (!Number.isInteger(collection.maxDepth) || collection.maxDepth < 0)) {
        throw manifestError(blueprintName, `collections.${name}.maxDepth must be a non-negative integer.`);
      }
      validateGlobList(collection.include, `collections.${name}.include`, blueprintName);
      validateGlobList(collection.exclude, `collections.${name}.exclude`, blueprintName);
    } else if (!isObject(collection.extract) || typeof collection.extract.type !== 'string' || !collection.extract.type) {
      throw manifestError(blueprintName, `Extract collection ${JSON.stringify(name)} requires extract.type.`);
    } else if (collection.extract.options !== undefined && !isObject(collection.extract.options)) {
      throw manifestError(blueprintName, `collections.${name}.extract.options must be an object.`);
    }
  }
}

/** @param {any} source @param {string} name @param {Record<string, any>} placeholders @param {string} blueprintName */
function validateCollectionSource(source, name, placeholders, blueprintName) {
  if (!isObject(source) || !COLLECTION_SCOPES.includes(source.scope) || typeof source.path !== 'string' || !source.path) {
    throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} requires source.scope (${COLLECTION_SCOPES.join(', ')}) and a non-empty source.path.`);
  }
  for (const match of scanPlaceholders(source.path, `blueprint.json collections.${name}.source.path`)) {
    if (match.parsed.namespace === 'Custom') {
      assertDefinedSourceCustom(match.parsed.key, placeholders, new Set(), name, blueprintName);
    }
  }
}

/** @param {string} key @param {Record<string, any>} placeholders @param {Set<string>} active @param {string} collectionName @param {string} blueprintName */
function assertDefinedSourceCustom(key, placeholders, active, collectionName, blueprintName) {
  const definition = placeholders[key];
  if (!definition) {
    throw manifestError(blueprintName, `Collection ${JSON.stringify(collectionName)} source references undefined custom placeholder ${JSON.stringify(key)}.`);
  }
  if (active.has(key)) {
    return;
  }
  active.add(key);
  for (const match of scanPlaceholders(definition.value, `blueprint.json placeholders.${key}.value`)) {
    if (match.parsed.namespace === 'Custom') {
      assertDefinedSourceCustom(match.parsed.key, placeholders, active, collectionName, blueprintName);
    }
  }
}

/** Validate source prompt usage and reject collection → prompt → collection cycles. */
function validateCollectionDependencyGraph(collections, placeholders, prompts, blueprintName) {
  const promptDefinitions = Object.fromEntries(prompts.map((prompt) => [prompt.key, prompt]));
  const graph = new Map();

  function sourcePromptReferences(source, collectionName) {
    const references = [];
    function visitCustom(key, visited) {
      if (visited.has(key)) return;
      visited.add(key);
      const definition = placeholders[key];
      if (!definition) return;
      for (const match of scanPlaceholders(definition.value, `blueprint.json placeholders.${key}.value`)) {
        if (match.parsed.namespace === 'Prompt') references.push(match.parsed);
        if (match.parsed.namespace === 'Custom') visitCustom(match.parsed.key, visited);
      }
    }
    for (const match of scanPlaceholders(source.path, `blueprint.json collections.${collectionName}.source.path`)) {
      if (match.parsed.namespace === 'Prompt') references.push(match.parsed);
      if (match.parsed.namespace === 'Custom') visitCustom(match.parsed.key, new Set());
    }
    return references;
  }

  for (const [name, collection] of Object.entries(collections)) {
    const node = `Collection:${name}`;
    const edges = [];
    for (const parsed of sourcePromptReferences(collection.source, name)) {
      const prompt = promptDefinitions[parsed.key];
      if (!prompt) {
        throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} source references undefined prompt ${JSON.stringify(parsed.key)}.`);
      }
      const selectionMode = prompt.selection?.mode ?? 'multi';
      if (prompt.type === 'selectFromCollection' && selectionMode === 'multi') {
        throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} source cannot depend on multi-select prompt ${JSON.stringify(parsed.key)}.`);
      }
      if (prompt.type === 'selectFromCollection' && !parsed.field) {
        throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} source must reference a field from single-select prompt ${JSON.stringify(parsed.key)}.`);
      }
      if (prompt.type !== 'selectFromCollection' && parsed.field) {
        throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} source scalar prompt ${JSON.stringify(parsed.key)} cannot use record field syntax.`);
      }
      edges.push(`Prompt:${parsed.key}`);
    }
    graph.set(node, edges);
  }
  for (const prompt of prompts) {
    graph.set(`Prompt:${prompt.key}`, prompt.type === 'selectFromCollection' ? [`Collection:${prompt.collection}`] : []);
  }

  const complete = new Set();
  const active = [];
  function visit(node) {
    if (active.includes(node)) {
      const chain = [...active.slice(active.indexOf(node)), node].join(' → ');
      throw manifestError(blueprintName, `Circular collection/prompt dependency: ${chain}.`);
    }
    if (complete.has(node)) return;
    active.push(node);
    for (const dependency of graph.get(node) || []) visit(dependency);
    active.pop();
    complete.add(node);
  }
  for (const node of graph.keys()) visit(node);
}

/** @param {any} patterns @param {string} location @param {string} blueprintName */
function validateGlobList(patterns, location, blueprintName) {
  if (patterns === undefined) {
    return;
  }
  if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== 'string')) {
    throw manifestError(blueprintName, `${location} must be an array of glob strings.`);
  }
  for (const pattern of patterns) {
    const portable = pattern.replace(/\\/gu, '/');
    if (!portable || portable.startsWith('/') || /^[A-Za-z]:\//u.test(portable) || portable.split('/').includes('..') || minimatch.makeRe(portable) === false) {
      throw manifestError(blueprintName, `${location} contains invalid or unsafe glob ${JSON.stringify(pattern)}.`);
    }
  }
}

/** @param {any} sort @param {string} type @param {string} name @param {string} blueprintName */
function validateCollectionSort(sort, type, name, blueprintName) {
  if (sort === undefined) {
    return;
  }
  const validField = type === 'filesystem'
    ? sort?.by === undefined || ['name', 'stem', 'extension', 'relativePath', 'parentName', 'depth', 'source'].includes(sort.by)
    : sort?.by === undefined || sort.by === 'source' || typeof sort.by === 'string' && IDENTIFIER_PATTERN.test(sort.by);
  if (!isObject(sort) || !validField ||
      (sort.direction !== undefined && !['ascending', 'descending'].includes(sort.direction))) {
    throw manifestError(blueprintName, `Collection ${JSON.stringify(name)} has an invalid sort definition.`);
  }
  optionalBoolean(sort, 'caseSensitive', blueprintName, `collections.${name}.sort`);
  optionalBoolean(sort, 'numeric', blueprintName, `collections.${name}.sort`);
}

/** @param {any} prompt @param {string} blueprintName @param {string} location @param {Record<string, any>} collections */
function validateCollectionPrompt(prompt, blueprintName, location, collections) {
  if (typeof prompt.collection !== 'string' || !Object.prototype.hasOwnProperty.call(collections, prompt.collection)) {
    throw manifestError(blueprintName, `${location}.collection must reference a declared collection.`);
  }
  const selection = prompt.selection ?? {};
  if (!isObject(selection) || (selection.mode !== undefined && !['single', 'multi'].includes(selection.mode)) ||
      (selection.order !== undefined && !['source', 'label', 'selection'].includes(selection.order))) {
    throw manifestError(blueprintName, `${location}.selection is invalid.`);
  }
  optionalBoolean(selection, 'required', blueprintName, `${location}.selection`);
  const mode = selection.mode ?? 'multi';
  const allowedDefaults = mode === 'single' ? ['first', 'none'] : ['all', 'none'];
  if (selection.defaultSelected !== undefined && !allowedDefaults.includes(selection.defaultSelected)) {
    throw manifestError(blueprintName, `${location}.selection.defaultSelected must be one of: ${allowedDefaults.join(', ')}.`);
  }
  if (prompt.option !== undefined && !isObject(prompt.option)) {
    throw manifestError(blueprintName, `${location}.option must be an object.`);
  }
  for (const property of ['label', 'description', 'detail']) {
    if (prompt.option?.[property] !== undefined) {
      if (typeof prompt.option[property] !== 'string') {
        throw manifestError(blueprintName, `${location}.option.${property} must be a string.`);
      }
      validateItemTemplateSyntax(prompt.option[property], `${location}.option.${property}`, blueprintName);
    }
  }
}

/** @param {string} template @param {string} location @param {string} blueprintName */
function validateItemTemplateSyntax(template, location, blueprintName) {
  if (template.includes('[[#each') || template.includes('[[/each]]')) {
    throw manifestError(blueprintName, `${location} cannot contain loops.`);
  }
  const transforms = require('../placeholders/constants').TRANSFORM_NAMES;
  const expression = /\[\[Item:[A-Za-z][A-Za-z0-9_]*(?:>([A-Za-z][A-Za-z0-9]*))?\]\]/gu;
  for (const match of template.matchAll(expression)) {
    if (match[1] && !transforms.includes(match[1])) {
      throw manifestError(blueprintName, `${location} contains unknown transformation ${JSON.stringify(match[1])}.`);
    }
  }
  const stripped = template.replace(expression, '');
  if (stripped.includes('[[')) {
    throw manifestError(blueprintName, `${location} contains invalid Item placeholder syntax.`);
  }
}

/** @param {any} value @param {string} blueprintName @param {string} [location] */
function rejectManifestBlocks(value, blueprintName, location = 'blueprint.json') {
  if (typeof value === 'string' && (value.includes('[[#') || value.includes('[[/'))) {
    throw manifestError(blueprintName, `Loop and conditional directives are unsupported in ${location}.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectManifestBlocks(item, blueprintName, `${location}[${index}]`));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      rejectManifestBlocks(item, blueprintName, `${location}.${key}`);
    }
  }
}

/** @param {any} selection @param {string} blueprintName */
function validateFileSelection(selection, blueprintName) {
  if (selection === undefined) {
    return;
  }
  if (!isObject(selection)) {
    throw manifestError(blueprintName, '"fileSelection" must be an object.');
  }
  optionalBoolean(selection, 'enabled', blueprintName, 'fileSelection');
  optionalBoolean(selection, 'includeUnlisted', blueprintName, 'fileSelection');
  optionalString(selection, 'title', blueprintName, 'fileSelection');
  optionalString(selection, 'placeholder', blueprintName, 'fileSelection');
  const options = selection.options ?? [];
  if (!Array.isArray(options) || ((selection.enabled ?? false) && options.length === 0)) {
    throw manifestError(blueprintName, 'fileSelection.options must be a non-empty array when file selection is enabled.');
  }
  const keys = new Set();
  for (const [index, option] of options.entries()) {
    const location = `fileSelection.options[${index}]`;
    if (!isObject(option)) {
      throw manifestError(blueprintName, `${location} must be an object.`);
    }
    identifier(option.key, `${location}.key`, blueprintName);
    if (keys.has(option.key)) {
      throw manifestError(blueprintName, `Duplicate file-selection option key ${JSON.stringify(option.key)}.`);
    }
    keys.add(option.key);
    if (typeof option.label !== 'string' || !option.label.trim()) {
      throw manifestError(blueprintName, `${location}.label must be a non-empty string.`);
    }
    for (const property of ['description', 'detail']) {
      optionalString(option, property, blueprintName, location);
    }
    optionalBoolean(option, 'required', blueprintName, location);
    optionalBoolean(option, 'defaultSelected', blueprintName, location);
    if (!Array.isArray(option.files) || option.files.length === 0) {
      throw manifestError(blueprintName, `${location}.files must be a non-empty array.`);
    }
    for (const entry of option.files) {
      if (typeof entry === 'string') {
        if (!entry) {
          throw manifestError(blueprintName, `${location}.files contains an empty literal path.`);
        }
      } else if (!isObject(entry) || typeof entry.glob !== 'string' || !entry.glob) {
        throw manifestError(blueprintName, `${location}.files entries must be literal path strings or objects with a string "glob".`);
      }
    }
  }
}

/** @param {any} object @param {string} property @param {string} blueprintName @param {string} [location] */
function optionalString(object, property, blueprintName, location = '') {
  if (object[property] !== undefined && typeof object[property] !== 'string') {
    throw manifestError(blueprintName, `${location ? `${location}.` : ''}${property} must be a string.`);
  }
}

/** @param {any} object @param {string} property @param {string} blueprintName @param {string} [location] */
function optionalBoolean(object, property, blueprintName, location = '') {
  if (object[property] !== undefined && typeof object[property] !== 'boolean') {
    throw manifestError(blueprintName, `${location ? `${location}.` : ''}${property} must be a boolean.`);
  }
}

/** @param {unknown} value @param {string} label @param {string} blueprintName */
function identifier(value, label, blueprintName) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw manifestError(blueprintName, `${label} must match ${IDENTIFIER_PATTERN}. Received ${JSON.stringify(value)}.`);
  }
}

/** @param {unknown} value */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} blueprintName @param {string} message */
function manifestError(blueprintName, message) {
  return new Error(`Invalid blueprint.json for “${blueprintName}”: ${message}`);
}

module.exports = { manifestError, validateBlueprintManifest };
