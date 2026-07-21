'use strict';

const MANIFEST_FILENAME = 'blueprint.json';
const SUPPORTED_MANIFEST_VERSION = 1;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const PROMPT_TYPES = Object.freeze(['input', 'pick', 'multiPick', 'confirm', 'file', 'folder', 'selectFromCollection']);
const COLLECTION_TYPES = Object.freeze(['filesystem', 'extract']);
const COLLECTION_SCOPES = Object.freeze(['blueprint', 'target', 'targetParent', 'workspace']);
const EMPTY_BEHAVIORS = Object.freeze(['continue', 'warn', 'error']);
const PATH_FORMATS = Object.freeze(['absolute', 'workspaceRelative', 'targetRelative', 'basename']);
const TOP_LEVEL_PROPERTIES = Object.freeze([
  'version',
  'name',
  'description',
  'omitEmptyFiles',
  'collections',
  'placeholders',
  'prompts',
  'fileSelection',
  'formatters',
  'workspaceEdits',
  'outputRoutes'
]);

module.exports = {
  COLLECTION_SCOPES,
  COLLECTION_TYPES,
  EMPTY_BEHAVIORS,
  IDENTIFIER_PATTERN,
  MANIFEST_FILENAME,
  PATH_FORMATS,
  PROMPT_TYPES,
  SUPPORTED_MANIFEST_VERSION,
  TOP_LEVEL_PROPERTIES
};
