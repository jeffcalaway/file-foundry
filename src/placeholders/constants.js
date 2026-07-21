'use strict';

const PLACEHOLDER_NAMES = Object.freeze([
  'FolderName',
  'FolderLetter',
  'DirName',
  'DirLetter'
]);

const TRANSFORM_NAMES = Object.freeze([
  'UpperCase',
  'LowerCase',
  'SentenceCase',
  'TitleCase',
  'SingularTitleCase',
  'CamelCase',
  'PascalCase',
  'SnakeCase',
  'UpperSnakeCase',
  'KebabCase',
  'TrainCase',
  'FlatCase'
]);

module.exports = { PLACEHOLDER_NAMES, TRANSFORM_NAMES };
