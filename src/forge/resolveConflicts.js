'use strict';

const path = require('path');

/**
 * Warn once about every existing destination and always preserve those files.
 *
 * @param {import('vscode')} vscode
 * @param {Array<{destinationPath: string, destinationRelativePath?: string}>} conflicts
 * @returns {Promise<'skip'>}
 */
async function resolveConflicts(vscode, conflicts) {
  if (conflicts.length === 0) return 'skip';

  const singular = conflicts.length === 1;
  const paths = conflicts
    .map((file) => `• ${displayPath(file)}`)
    .join('\n');
  const message = singular
    ? 'File Foundry will skip 1 file because it already exists.'
    : `File Foundry will skip ${conflicts.length} files because they already exist.`;
  await vscode.window.showWarningMessage(message, { modal: true, detail: paths });
  return 'skip';
}

function displayPath(file) {
  const value = file.destinationRelativePath || file.destinationPath;
  return value.split(path.sep).join('/');
}

module.exports = { displayPath, resolveConflicts };
