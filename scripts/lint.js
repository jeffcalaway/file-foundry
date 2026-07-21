'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = ['src', 'test', 'scripts'];
const files = roots.flatMap(findJavaScriptFiles).sort();
let failed = false;

for (const file of files) {
  const contents = fs.readFileSync(file, 'utf8');
  if (/[^\S\r\n]+$/mu.test(contents)) {
    process.stderr.write(`${file}: trailing whitespace detected\n`);
    failed = true;
  }

  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    process.stderr.write(check.stderr || check.stdout);
    failed = true;
  }
}

for (const file of ['package.json', '.vscode/launch.json', '.vscode/tasks.json']) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(`${file}: ${error.message}\n`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  process.stdout.write(`Linted ${files.length} JavaScript files and 3 JSON files.\n`);
}

/** @param {string} root */
function findJavaScriptFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory()
      ? findJavaScriptFiles(entryPath)
      : entry.name.endsWith('.js') ? [entryPath] : [];
  });
}
