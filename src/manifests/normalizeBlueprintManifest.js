'use strict';

/**
 * Apply release-one defaults after schema validation.
 *
 * @param {Record<string, any>} manifest
 * @param {string} directoryName
 */
function normalizeBlueprintManifest(manifest, directoryName) {
  const prompts = (manifest.prompts || []).map((prompt) => ({
    ...prompt,
    required: prompt.required ?? false,
    password: prompt.password ?? false,
    separator: prompt.separator ?? ', ',
    pathFormat: prompt.pathFormat ?? 'absolute',
    trueLabel: prompt.trueLabel ?? 'Yes',
    falseLabel: prompt.falseLabel ?? 'No',
    trueValue: String(prompt.trueValue ?? 'true'),
    falseValue: String(prompt.falseValue ?? 'false'),
    selection: prompt.type === 'selectFromCollection' ? {
      mode: prompt.selection?.mode ?? 'multi',
      defaultSelected: prompt.selection?.defaultSelected ?? 'none',
      required: prompt.selection?.required ?? false,
      order: prompt.selection?.order ?? 'source'
    } : prompt.selection,
    option: prompt.type === 'selectFromCollection' ? {
      label: prompt.option?.label ?? '[[Item:name]]',
      description: prompt.option?.description,
      detail: prompt.option?.detail
    } : prompt.option
  }));

  const collections = Object.fromEntries(Object.entries(manifest.collections || {}).map(([key, collection]) => [key, {
    ...collection,
    type: collection.type ?? 'filesystem',
    kind: collection.kind ?? 'any',
    recursive: collection.recursive ?? false,
    includeHidden: collection.includeHidden ?? false,
    followSymlinks: collection.followSymlinks ?? false,
    include: collection.include ?? [],
    exclude: collection.exclude ?? [],
    onEmpty: collection.onEmpty ?? 'continue',
    onMissing: collection.onMissing ?? 'error',
    initialRecords: collection.initialRecords ?? [],
    sort: collection.sort ?? ((collection.type ?? 'filesystem') === 'filesystem' ? {
      by: 'name', direction: 'ascending', caseSensitive: false, numeric: true
    } : { by: 'source', direction: 'ascending', caseSensitive: false, numeric: true })
  }]));

  const fileSelectionSource = manifest.fileSelection || {};
  const fileSelection = {
    enabled: fileSelectionSource.enabled ?? false,
    title: fileSelectionSource.title || 'Choose files to generate',
    placeholder: fileSelectionSource.placeholder || 'Select the files and features to include.',
    includeUnlisted: fileSelectionSource.includeUnlisted ?? true,
    options: (fileSelectionSource.options || []).map((option) => ({
      ...option,
      required: option.required ?? false,
      defaultSelected: option.defaultSelected ?? false
    }))
  };

  const formatters = (manifest.formatters || []).map((formatter) => ({
    ...formatter,
    sourceFiles: [...formatter.sourceFiles]
  }));
  const workspaceEdits = (manifest.workspaceEdits || []).map((edit) => ({
    ...edit,
    moduleNamePrompt: edit.moduleNamePrompt ?? 'ModuleName',
    parentModuleOption: edit.parentModuleOption ?? 'parentModule',
    functionsOption: edit.functionsOption ?? 'functions'
  }));
  const outputRoutes = (manifest.outputRoutes || []).map((route) => ({
    ...route,
    option: route.option ?? (route.type === 'parentDirectory' ? 'parentModule' : 'templateBlock')
  }));

  return {
    version: manifest.version,
    name: typeof manifest.name === 'string' && manifest.name.trim()
      ? manifest.name.trim()
      : directoryName,
    description: manifest.description || undefined,
    openFile: manifest.openFile || undefined,
    omitEmptyFiles: manifest.omitEmptyFiles ?? false,
    collections,
    placeholders: manifest.placeholders || {},
    prompts,
    fileSelection,
    formatters,
    workspaceEdits,
    outputRoutes
  };
}

module.exports = { normalizeBlueprintManifest };
