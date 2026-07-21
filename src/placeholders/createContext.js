'use strict';

const path = require('path');

/**
 * @param {string} targetDirectory
 * @returns {{FolderName: string, FolderLetter: string, DirName: string, DirLetter: string}}
 */
function createContext(targetDirectory) {
  const normalized = path.resolve(targetDirectory);
  const folderName = path.basename(normalized);
  const parent = path.dirname(normalized);
  const dirName = path.basename(parent);

  if (!folderName || folderName === path.parse(normalized).root) {
    throw new Error(`Cannot determine FolderName from target directory: ${targetDirectory}`);
  }
  if (!dirName || parent === path.parse(parent).root) {
    throw new Error(`Cannot determine DirName from target directory: ${targetDirectory}`);
  }

  return {
    FolderName: folderName,
    FolderLetter: Array.from(folderName)[0],
    DirName: dirName,
    DirLetter: Array.from(dirName)[0]
  };
}

module.exports = { createContext };
