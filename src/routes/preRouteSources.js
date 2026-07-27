'use strict';

const { normalizeSourcePath } = require('../selection/matchSelectionEntries');

/** Select sources whose prompt values are needed before output destinations can resolve. */
function preRouteSources(manifest, selectedOutputKeys, selectedSources, optionMatches) {
  const activeKeys = new Set(selectedOutputKeys);
  const optionIndexes = new Map(manifest.fileSelection.options.map((option, index) => [option.key, index]));
  const activeRoutes = manifest.outputRoutes.filter((route) => activeKeys.has(route.option));
  if (activeRoutes.length === 0) return [];
  const firstRouteIndex = Math.min(...activeRoutes.map((route) => optionIndexes.get(route.option)));
  const eligiblePaths = new Set();
  for (let index = 0; index < firstRouteIndex; index += 1) {
    const option = manifest.fileSelection.options[index];
    if (!activeKeys.has(option.key)) continue;
    for (const sourcePath of optionMatches.get(option.key) || []) eligiblePaths.add(sourcePath);
  }
  for (const route of activeRoutes) {
    if (route.type === 'parentDirectory') eligiblePaths.add(normalizeSourcePath(route.source));
  }
  const routedPaths = new Set(activeRoutes
    .filter((route) => route.type === 'wordpressTemplateBlock')
    .flatMap((route) => [route.legacySource, route.modernSource])
    .map(normalizeSourcePath));
  return selectedSources.filter((source) => {
    const sourcePath = normalizeSourcePath(source.relativePath);
    return eligiblePaths.has(sourcePath) && !routedPaths.has(sourcePath);
  });
}

module.exports = { preRouteSources };
