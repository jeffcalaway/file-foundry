'use strict';

/** Align consecutive PHP-style assignment lines at their equal signs. */
function alignAssignments(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/u);
  let index = 0;

  while (index < lines.length) {
    const group = [];
    while (index < lines.length) {
      const match = /^(\s*\$this->[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/u.exec(lines[index]);
      if (!match) break;
      group.push({ index, left: match[1], right: match[2] });
      index += 1;
    }
    if (group.length > 0) {
      const width = Math.max(...group.map((item) => item.left.length));
      for (const item of group) lines[item.index] = `${item.left.padEnd(width)} = ${item.right}`;
      continue;
    }
    index += 1;
  }

  return lines.join(newline);
}

/** Align consecutive PHP variable assignments and associative-array arrows. */
function alignPhpOperators(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/u);
  alignGroups(lines, /^(\s*\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/u, '=');
  alignGroups(lines, /^(\s*'[^'\r\n]+')\s*=>\s*(.+)$/u, '=>');
  return lines.join(newline);
}

function alignGroups(lines, pattern, operator) {
  let index = 0;
  while (index < lines.length) {
    const group = [];
    while (index < lines.length) {
      const match = pattern.exec(lines[index]);
      if (!match) break;
      group.push({ index, left: match[1], right: match[2] });
      index += 1;
    }
    if (group.length > 0) {
      const width = Math.max(...group.map((item) => item.left.length));
      for (const item of group) lines[item.index] = `${item.left.padEnd(width)} ${operator} ${item.right}`;
      continue;
    }
    index += 1;
  }
}

/** Apply manifest formatters declared for a blueprint source file. */
function applySourceFormatters(source, relativePath, formatters = []) {
  return formatters.reduce((formatted, formatter) => {
    if (!formatter.sourceFiles.includes(relativePath)) return formatted;
    if (formatter.type === 'alignAssignments') return alignAssignments(formatted);
    if (formatter.type === 'alignPhpOperators') return alignPhpOperators(formatted);
    return formatted;
  }, source);
}

module.exports = { alignAssignments, alignPhpOperators, applySourceFormatters };
