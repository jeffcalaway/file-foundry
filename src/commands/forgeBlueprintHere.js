'use strict';

const fs = require('fs');
const path = require('path');
const { discoverBlueprints } = require('../blueprints/discoverBlueprints');
const { resolveBlueprintDirectory } = require('../blueprints/resolveBlueprintDirectory');
const { buildForgePlan } = require('../forge/buildForgePlan');
const { buildVirtualOutputFiles } = require('../forge/buildVirtualOutputFiles');
const { executeForgePlan } = require('../forge/executeForgePlan');
const { inspectSelectedSources } = require('../forge/inspectSelectedSources');
const { resolveConflicts } = require('../forge/resolveConflicts');
const { resolveRequiredForgeInputs } = require('../forge/resolveRequiredForgeInputs');
const { walkDirectory } = require('../filesystem/walkDirectory');
const { normalizeBlueprintManifest } = require('../manifests/normalizeBlueprintManifest');
const { createContext } = require('../placeholders/createContext');
const { collectOutputSelection } = require('../selection/collectOutputSelection');
const { findExistingSourcePaths, hasExistingPreselectedFiles } = require('../selection/hasExistingPreselectedFiles');
const { matchSelectionEntries, normalizeSourcePath } = require('../selection/matchSelectionEntries');
const { resolveSelectedSources } = require('../selection/resolveSelectedSources');
const { buildUsefulGroupPhpRegistryUpdates } = require('../integrations/usefulGroupPhpRegistry');
const { resolveOptionalPath } = require('../utils/resolveOptionalPath');
const { resolveOutputRoutes } = require('../routes/resolveOutputRoutes');
const { preRouteSources } = require('../routes/preRouteSources');
const { errorMessage, log, technicalError } = require('../utils/outputChannel');
const { showBlueprintDirectoryError, workspaceDirectories } = require('./uiHelpers');

const fsp = fs.promises;

/**
 * @param {import('vscode')} vscode
 * @param {import('vscode').OutputChannel} outputChannel
 */
function createForgeBlueprintHereCommand(vscode, outputChannel, extractorService, blueprintUsageStore) {
  /** @param {import('vscode').Uri | undefined} resource */
  return async function forgeBlueprintHere(resource) {
    let targetUri;
    try {
      targetUri = await selectTargetDirectory(vscode, resource);
      if (!targetUri) {
        return;
      }

      const configuredPath = vscode.workspace
        .getConfiguration('fileFoundry', targetUri)
        .get('blueprintsDirectory', '');

      let blueprintRoot;
      try {
        blueprintRoot = await resolveBlueprintDirectory(configuredPath, {
          targetDirectory: targetUri.fsPath,
          workspaceDirectories: workspaceDirectories(vscode)
        });
      } catch (error) {
        log(outputChannel, `Blueprint directory validation failed: ${technicalError(error)}`);
        await showBlueprintDirectoryError(vscode, errorMessage(error));
        return;
      }

      log(outputChannel, `Resolved blueprint directory: ${blueprintRoot}`);
      log(outputChannel, `Selected target folder: ${targetUri.fsPath}`);
      const configuration = vscode.workspace.getConfiguration('fileFoundry', targetUri);

      const blueprints = await discoverBlueprints(blueprintRoot);
      if (blueprints.length === 0) {
        await vscode.window.showErrorMessage(
          `No blueprints were found in ${blueprintRoot}. Add an immediate child directory for each blueprint.`
        );
        return;
      }
      for (const blueprint of blueprints) {
        for (const warning of blueprint.warnings) {
          log(outputChannel, `Manifest warning: ${warning}`);
        }
        if (blueprint.manifestError) {
          log(outputChannel, `Invalid blueprint discovered at ${blueprint.directory}: ${technicalError(blueprint.manifestError)}`);
        }
      }

      const mostSelectedEnabled = configuration.get('mostSelectedBlueprints', true);
      const mostSelected = mostSelectedEnabled && blueprintUsageStore
        ? blueprintUsageStore.getMostSelected(blueprints)
        : [];
      const selection = await vscode.window.showQuickPick(
        buildBlueprintPickerItems(vscode, blueprints, mostSelected),
        {
          title: `Forge a blueprint into ${formatForgeTarget(targetUri.fsPath)}`,
          placeHolder: 'Select a File Foundry blueprint',
          matchOnDescription: true
        }
      );
      if (!selection) {
        return;
      }
      if (selection.blueprint.manifestError) {
        await vscode.window.showErrorMessage(errorMessage(selection.blueprint.manifestError));
        return;
      }

      if (mostSelectedEnabled && blueprintUsageStore) {
        try {
          await blueprintUsageStore.recordSelection(selection.blueprint.directoryName);
        } catch (error) {
          log(outputChannel, `Unable to update Most Selected history: ${technicalError(error)}`);
        }
      }

      log(outputChannel, `Selected blueprint: ${selection.blueprint.name} (${selection.blueprint.directory})`);
      const manifest = selection.blueprint.manifest || normalizeBlueprintManifest(
        { version: 1 },
        selection.blueprint.directoryName
      );
      const builtInContext = createContext(targetUri.fsPath);
      const sourceEntries = await walkDirectory(selection.blueprint.directory);
      const optionMatches = matchSelectionEntries(manifest.fileSelection, sourceEntries);
      const suppressPreselection = await hasExistingPreselectedFiles({
        fileSelection: manifest.fileSelection,
        optionMatches,
        sourceEntries,
        targetDirectory: targetUri.fsPath,
        builtInContext
      });
      if (suppressPreselection) {
        log(outputChannel, 'Cleared default output selections because at least one default output already exists.');
      }
      const selectedOptionKeys = await collectOutputSelection(vscode, manifest.fileSelection, { suppressPreselection });
      if (selectedOptionKeys === undefined) {
        log(outputChannel, 'Forge canceled during output selection before writing files.');
        return;
      }
      let selectedSources = resolveSelectedSources(
        manifest.fileSelection,
        sourceEntries,
        optionMatches,
        selectedOptionKeys
      );
      const workspacePaths = workspaceDirectories(vscode);
      const workspaceDirectory = workspacePaths
        .filter((directory) => targetUri.fsPath === directory || targetUri.fsPath.startsWith(`${directory}${path.sep}`))
        .sort((left, right) => right.length - left.length)[0];
      const extractorPathBases = workspaceDirectory
        ? [workspaceDirectory, ...workspacePaths.filter((directory) => directory !== workspaceDirectory)]
        : workspacePaths;
      const registry = await extractorService.ensureLoaded({
        presetsFile: resolveOptionalPath(configuration.get('extractorsFile', ''), extractorPathBases),
        customDirectory: resolveOptionalPath(configuration.get('customExtractorsDirectory', ''), extractorPathBases),
        trusted: vscode.workspace.isTrusted,
        log: (message) => log(outputChannel, message)
      });
      const resolveInputs = (inspectedSources, initialInputs) => resolveRequiredForgeInputs({
        vscode,
        inspectedSources,
        manifest,
        builtInContext,
        initialInputs,
        collectionContext: {
          blueprintDirectory: selection.blueprint.directory,
          targetDirectory: targetUri.fsPath,
          workspaceDirectory,
          trusted: vscode.workspace.isTrusted,
          extractorRegistry: registry,
          safeContext: builtInContext,
          virtualFiles: buildVirtualOutputFiles(inspectedSources, targetUri.fsPath, builtInContext),
          log: (message) => log(outputChannel, message)
        },
        promptContext: {
          blueprintDirectory: selection.blueprint.directory,
          targetDirectory: targetUri.fsPath,
          targetUri,
          workspaceDirectories: workspacePaths,
          log: (message) => log(outputChannel, message)
        },
        selectedOutputKeys: selectedOptionKeys,
        log: (message) => log(outputChannel, message)
      });

      let inputs;
      let earlyInspectedSources = [];
      const earlySources = preRouteSources(manifest, selectedOptionKeys, selectedSources, optionMatches);
      const earlyExistingPaths = await findExistingSourcePaths({
        sourceEntries: earlySources,
        targetDirectory: targetUri.fsPath,
        builtInContext
      });
      const earlyPromptSources = withoutExistingSources(earlySources, earlyExistingPaths);
      if (earlyPromptSources.length > 0) {
        earlyInspectedSources = await inspectSelectedSources(earlyPromptSources, { blueprintName: manifest.name });
        inputs = await resolveInputs(earlyInspectedSources);
        if (inputs === undefined) {
          log(outputChannel, 'Forge canceled during blueprint prompts before output destination selection.');
          return;
        }
      }
      const routedOutputs = await resolveOutputRoutes({
        vscode,
        manifest,
        selectedOutputKeys: selectedOptionKeys,
        selectedSources,
        targetDirectory: targetUri.fsPath,
        workspaceDirectories: workspacePaths,
        builtInContext: inputs ? {
          ...builtInContext,
          Custom: inputs.custom,
          Prompt: inputs.prompts
        } : builtInContext
      });
      if (routedOutputs === undefined) {
        log(outputChannel, 'Forge canceled during output destination selection before writing files.');
        return;
      }
      selectedSources = routedOutputs.selectedSources;
      if (selectedSources.length === 0) {
        log(outputChannel, 'Forge stopped because the selected output set is empty.');
        await vscode.window.showInformationMessage('File Foundry has no files or directories to forge for that selection.');
        return;
      }

      const existingSourcePaths = await findExistingSourcePaths({
        sourceEntries: selectedSources,
        targetDirectory: targetUri.fsPath,
        builtInContext,
        destinationOverrides: routedOutputs.destinationOverrides
      });
      const promptSources = withoutExistingSources(selectedSources, existingSourcePaths);
      const promptSourcePaths = new Set(promptSources.map((source) => normalizeSourcePath(source.relativePath)));
      const reusableInspectedSources = earlyInspectedSources.filter((source) =>
        promptSourcePaths.has(normalizeSourcePath(source.relativePath))
      );
      const reusablePaths = new Set(reusableInspectedSources.map((source) => normalizeSourcePath(source.relativePath)));
      const remainingPromptSources = promptSources.filter((source) =>
        !reusablePaths.has(normalizeSourcePath(source.relativePath))
      );
      const additionallyInspectedSources = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `File Foundry: inspecting “${manifest.name}”…`
        },
        () => inspectSelectedSources(remainingPromptSources, { blueprintName: manifest.name })
      );
      const inspectedPromptSources = [...reusableInspectedSources, ...additionallyInspectedSources];
      inputs = await resolveInputs(inspectedPromptSources, inputs);
      if (inputs === undefined) {
        log(outputChannel, 'Forge canceled during blueprint prompts before writing files.');
        return;
      }
      const replacementContext = {
        ...builtInContext,
        Custom: inputs.custom,
        Prompt: inputs.prompts,
        PromptRaw: inputs.rawPrompts,
        Collection: inputs.collections,
        Output: inputs.outputs,
        Manifest: manifest
      };
      const inspectedByPath = new Map(inspectedPromptSources.map((source) => [normalizeSourcePath(source.relativePath), source]));
      const planSources = selectedSources.map((source) =>
        inspectedByPath.get(normalizeSourcePath(source.relativePath)) || source
      );

      const plan = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `File Foundry: validating “${manifest.name}”…`
        },
        () => buildForgePlan({
          blueprintDirectory: selection.blueprint.directory,
          targetDirectory: targetUri.fsPath,
          sourceEntries: planSources,
          context: replacementContext,
          destinationOverrides: routedOutputs.destinationOverrides,
          skipExistingFiles: true
        })
      );
      plan.workspaceUpdates = await buildUsefulGroupPhpRegistryUpdates({
        vscode,
        manifest,
        context: replacementContext,
        plan,
        workspaceDirectories: workspacePaths
      });
      await resolveConflicts(vscode, plan.conflicts);

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `File Foundry: forging “${manifest.name}”…`
        },
        () => executeForgePlan(plan, 'skip', {
          onDirectoryCreated: (directory) => log(outputChannel, `Directory created: ${directory.destinationPath}`),
          onFileCreated: (file) => log(outputChannel, `File created: ${file.destinationPath}`),
          onFileSkipped: (file) => log(outputChannel, `File skipped: ${file.destinationPath}`),
          onFileOverwritten: (file) => log(outputChannel, `File overwritten: ${file.destinationPath}`),
          onWorkspaceFileUpdated: (file) => log(outputChannel, `Workspace file updated: ${file.destinationPath}`)
        })
      );

      await openSingleCreatedFile(vscode, plan, result);

      const summary = formatSuccessSummary(
        manifest.name,
        result,
        manifest.fileSelection.enabled ? plan.files.length : undefined
      );
      const action = await vscode.window.showInformationMessage(summary, 'Reveal Target Folder');
      if (action === 'Reveal Target Folder') {
        await vscode.commands.executeCommand('revealInExplorer', targetUri);
      }
    } catch (error) {
      log(outputChannel, `Forge failed: ${technicalError(error)}`);
      await vscode.window.showErrorMessage(`File Foundry could not forge the blueprint: ${errorMessage(error)}`);
    }
  };
}

function buildBlueprintPickerItems(vscode, blueprints, mostSelected = []) {
  const favoriteNames = new Set(mostSelected.map((item) => item.blueprint.directoryName));
  const regularItems = blueprints
    .filter((blueprint) => !favoriteNames.has(blueprint.directoryName))
    .map((blueprint) => blueprintPickerItem(blueprint, false));
  if (mostSelected.length === 0) return regularItems;
  const separatorKind = vscode.QuickPickItemKind?.Separator;
  const items = [
    { label: 'Most Selected', kind: separatorKind },
    ...mostSelected.map((item) => blueprintPickerItem(item.blueprint, true))
  ];
  if (regularItems.length > 0) items.push(
    { label: 'All Blueprints', kind: separatorKind },
    ...regularItems
  );
  return items;
}

function blueprintPickerItem(blueprint, starred) {
  return {
    label: starred ? `$(star-full) ${blueprint.name}` : blueprint.name,
    description: blueprint.description,
    blueprint
  };
}

/** Open the only newly created output in its normal VS Code editor. */
async function openSingleCreatedFile(vscode, plan, result) {
  if (result.filesCreated !== 1) return false;
  const createdFiles = plan.files.filter((file) => !file.exists);
  if (createdFiles.length !== 1) return false;
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(createdFiles[0].destinationPath));
  return true;
}

function withoutExistingSources(sources, existingPaths) {
  return sources.filter((source) => !existingPaths.has(normalizeSourcePath(source.relativePath)));
}

/**
 * @param {import('vscode')} vscode
 * @param {import('vscode').Uri | undefined} resource
 * @returns {Promise<import('vscode').Uri | undefined>}
 */
async function selectTargetDirectory(vscode, resource) {
  let targetUri = resource;

  if (!targetUri && vscode.window.activeTextEditor) {
    targetUri = vscode.Uri.file(path.dirname(vscode.window.activeTextEditor.document.uri.fsPath));
  }

  if (!targetUri) {
    const selections = await vscode.window.showOpenDialog({
      title: 'Select the folder where the blueprint should be forged',
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Forge Here'
    });
    targetUri = selections?.[0];
  }

  if (!targetUri) {
    return undefined;
  }
  if (targetUri.scheme !== 'file') {
    throw new Error('The target must be a local file-system folder.');
  }

  let stats;
  try {
    stats = await fsp.lstat(targetUri.fsPath);
  } catch (error) {
    throw new Error(`The selected target folder is unavailable: ${error.message}`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('The selected target must be a real directory, not a file or symbolic link.');
  }

  return targetUri;
}

/**
 * @param {string} blueprintName
 * @param {{filesCreated: number, foldersCreated: number, filesSkipped: number, filesOverwritten: number}} result
 */
function formatSuccessSummary(blueprintName, result, filesSelected) {
  const parts = [];
  if (filesSelected !== undefined) {
    parts.push(`${filesSelected} ${pluralize(filesSelected, 'file')} selected`);
  }
  parts.push(
    `${result.filesCreated} ${pluralize(result.filesCreated, 'file')} created`,
    `${result.foldersCreated} ${pluralize(result.foldersCreated, 'folder')} created`
  );
  if (result.filesOverwritten > 0) {
    parts.push(`${result.filesOverwritten} ${pluralize(result.filesOverwritten, 'file')} overwritten`);
  }
  if (result.filesSkipped > 0) {
    parts.push(`${result.filesSkipped} ${pluralize(result.filesSkipped, 'file')} skipped`);
  }
  if (result.workspaceFilesUpdated > 0) {
    parts.push(`${result.workspaceFilesUpdated} workspace ${pluralize(result.workspaceFilesUpdated, 'file')} updated`);
  }
  return `File Foundry forged “${blueprintName}”: ${parts.join(', ')}.`;
}

/** @param {number} count @param {string} singular */
function pluralize(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}

/** Show only the target folder and its immediate parent in picker titles. */
function formatForgeTarget(targetPath) {
  const normalized = path.normalize(targetPath);
  const folderName = path.basename(normalized);
  const parentName = path.basename(path.dirname(normalized));
  const segments = [parentName, folderName].filter(Boolean);
  return segments.length > 0 ? `/${segments.join('/')}/` : '/';
}

module.exports = {
  buildBlueprintPickerItems,
  createForgeBlueprintHereCommand,
  openSingleCreatedFile,
  formatForgeTarget,
  formatSuccessSummary,
  selectTargetDirectory
};
