'use strict';

const { tokenizeWords } = require('./tokenizeWords');

/** @param {string} word */
function capitalize(word) {
  if (!word) {
    return '';
  }
  const [first, ...rest] = Array.from(word);
  return first.toUpperCase() + rest.join('').toLowerCase();
}

/** Apply conservative English singularization to a display word. */
function singularize(word) {
  if (/[^aeiou]ies$/u.test(word)) return `${word.slice(0, -3)}y`;
  if (/(?:[sxz]es|ches|shes)$/u.test(word)) return word.slice(0, -2);
  if (/s$/u.test(word) && !/(?:ss|us|is)$/u.test(word)) return word.slice(0, -1);
  return word;
}

const TRANSFORMS = Object.freeze({
  UpperCase: (value) => tokenizeWords(value).join(' ').toUpperCase(),
  LowerCase: (value) => tokenizeWords(value).join(' '),
  SentenceCase: (value) => capitalize(tokenizeWords(value).join(' ')),
  TitleCase: (value) => tokenizeWords(value).map(capitalize).join(' '),
  SingularTitleCase: (value) => {
    const words = tokenizeWords(value);
    if (words.length === 0) return '';
    words[words.length - 1] = singularize(words[words.length - 1]);
    return words.map(capitalize).join(' ');
  },
  CamelCase: (value) => {
    const words = tokenizeWords(value);
    return words.length === 0 ? '' : words[0] + words.slice(1).map(capitalize).join('');
  },
  PascalCase: (value) => tokenizeWords(value).map(capitalize).join(''),
  SnakeCase: (value) => tokenizeWords(value).join('_'),
  UpperSnakeCase: (value) => tokenizeWords(value).join('_').toUpperCase(),
  KebabCase: (value) => tokenizeWords(value).join('-'),
  TrainCase: (value) => tokenizeWords(value).map(capitalize).join('-'),
  FlatCase: (value) => tokenizeWords(value).join('')
});

/**
 * @param {string} name
 * @param {string} value
 * @returns {string}
 */
function applyTransform(name, value) {
  return TRANSFORMS[name](value);
}

module.exports = { TRANSFORMS, applyTransform };
