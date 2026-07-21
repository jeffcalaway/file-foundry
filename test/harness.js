'use strict';

const tests = [];

/** @param {string} name @param {() => void | Promise<void>} callback */
function test(name, callback) {
  tests.push({ name, callback });
}

async function run() {
  let failures = 0;

  for (const entry of tests) {
    try {
      await entry.callback();
      process.stdout.write(`✓ ${entry.name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`✗ ${entry.name}\n${error.stack || error}\n`);
    }
  }

  process.stdout.write(`\n${tests.length - failures}/${tests.length} tests passed.\n`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

module.exports = { run, test };
