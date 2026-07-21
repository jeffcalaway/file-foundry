'use strict';

const { TextDecoder } = require('util');

const MAX_SAMPLE_BYTES = 8192;

/**
 * Detect binary data using NUL/control-byte checks plus strict UTF-8 decoding.
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isBinaryBuffer(buffer) {
  if (buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, MAX_SAMPLE_BYTES);
  let suspiciousBytes = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 27) {
      suspiciousBytes += 1;
    }
  }

  if (suspiciousBytes / sample.length > 0.1) {
    return true;
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}

module.exports = { isBinaryBuffer };
