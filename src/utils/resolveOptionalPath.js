'use strict';

const os = require('os');
const path = require('path');

/** @param {string} configured @param {string[]} workspaceDirectories */
function resolveOptionalPath(configured, workspaceDirectories) {
  if (typeof configured !== 'string' || !configured.trim()) return undefined;
  let value = configured.trim();
  if (value === '~') value = os.homedir();
  else if (value.startsWith('~/') || value.startsWith('~\\')) value = path.join(os.homedir(), value.slice(2));
  if (path.isAbsolute(value)) return path.resolve(value);
  if (!workspaceDirectories[0]) throw new Error(`Relative configured path requires an open workspace: ${configured}.`);
  return path.resolve(workspaceDirectories[0], value);
}

module.exports = { resolveOptionalPath };
