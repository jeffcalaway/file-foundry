'use strict';

const path = require('path');

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F]/u;

/**
 * @param {string} segment
 * @param {string} sourceRelativePath
 * @param {NodeJS.Platform} [platform]
 */
function validatePathSegment(segment, sourceRelativePath, platform = process.platform) {
  if (!segment || segment === '.' || segment === '..') {
    throw new Error(`Generated an empty or unsafe path name from source: ${sourceRelativePath}.`);
  }
  if (segment.includes('\0') || segment.includes('/') || segment.includes('\\')) {
    throw new Error(`Generated path name ${JSON.stringify(segment)} contains an invalid path separator. Source: ${sourceRelativePath}.`);
  }
  if (platform === 'win32') {
    if (WINDOWS_INVALID_CHARS.test(segment) || /[. ]$/u.test(segment) || WINDOWS_RESERVED_NAME.test(segment)) {
      throw new Error(`Generated path name ${JSON.stringify(segment)} is invalid on Windows. Source: ${sourceRelativePath}.`);
    }
  }
  if (platform === 'darwin' && segment.includes(':')) {
    throw new Error(`Generated path name ${JSON.stringify(segment)} is invalid on macOS. Source: ${sourceRelativePath}.`);
  }
}

/**
 * Resolve and verify a relative output path remains within the target root.
 *
 * @param {string} targetDirectory
 * @param {string[]} outputSegments
 * @param {string} sourceRelativePath
 * @returns {string}
 */
function normalizeDestination(targetDirectory, outputSegments, sourceRelativePath) {
  for (const segment of outputSegments) {
    validatePathSegment(segment, sourceRelativePath);
  }

  const targetRoot = path.resolve(targetDirectory);
  const destination = path.resolve(targetRoot, ...outputSegments);
  const relative = path.relative(targetRoot, destination);

  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Generated destination escapes or replaces the target folder. Source: ${sourceRelativePath}.`);
  }

  return destination;
}

module.exports = { normalizeDestination, validatePathSegment };
