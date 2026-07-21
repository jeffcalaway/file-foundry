'use strict';

/**
 * @param {import('vscode').OutputChannel} channel
 * @param {string} message
 */
function log(channel, message) {
  channel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function technicalError(error) {
  return error instanceof Error && error.stack ? error.stack : String(error);
}

module.exports = { errorMessage, log, technicalError };
