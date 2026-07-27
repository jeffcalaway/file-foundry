# Change Log

## 1.0.3

- Fixed forging blueprints whose selected output paths contain prompt or custom placeholders by deferring preflight path checks until those values are available.
- Replaced fragile placeholder error-message matching with structured missing-value errors.
- Added regression coverage for prompt-derived WordPress package paths such as `[[Prompt:ModuleName>KebabCase]]/class-setup.php`.
- Added parent-directory output routing so package contents can be forged directly into the selected module folder while a parent module file is generated beside it.

## 1.0.2

- When running the `forgeBlueprintHere` command, use active editor path as fallback target directory.

## 1.0.1

- Ignore `.git` folder in the blueprints directory so that it doesn't get included in the blueprint options.

## 1.0.0

- Added GitHub repository, homepage, and issue-tracker metadata to the extension package.
- Enabled `vsce` to rewrite README assets to absolute GitHub URLs.
- Added Marketplace-compatible PNG versions of the README diagrams while retaining their SVG sources.

## 0.5.0

- Added a starred, three-item Most Selected blueprint section backed by bounded workspace-local usage history.
- Added count-first ranking with recency-based tie eviction and stable oldest-to-newest display within ties.
- Added a globally and per-workspace configurable `fileFoundry.mostSelectedBlueprints` setting, enabled by default.
- Added **File Foundry: Clear Most Selected Blueprints** to clear the current workspace history.
- Reduced forge I/O by reusing discovered manifests and early-inspected source buffers.
- Added bounded-concurrency manifest discovery to balance responsiveness with CPU and file-descriptor use.
- Bundled the runtime into one extension-host file and excluded source modules and build dependencies from the VSIX.
- Documented the extension's performance and resource model.

## 0.4.4

- A forge that creates exactly one new file now opens that file automatically.
- Reorganized and expanded blueprint-author documentation with a task-oriented table of contents, complete feature references, examples, and maintained visual assets.
- Added README regression coverage for public manifest features, internal links, code fences, and visual assets.

## 0.4.3

- Added case-sensitive `contains` conditions for strings and multi-select prompt field projections.
- Enabled templates to select helpers based on partial names across selected collection records.

## 0.4.2

- Standalone loop directive lines are removed so repeated records render without blank separator lines.
- Added manifest-driven assignment alignment for generated PHP parent modules.
- Added guarded `useful-group/functions.php` registration for selected WordPress parent modules and functions files.
- Added automatic WordPress package namespace resolution from `useful-group/functions.php` with prompt fallback.
- Added in-memory collection sources for selected outputs that do not exist on disk yet.
- Added legacy and modern WordPress Template Block destinations with safe workspace routing and missing-folder warnings.
- Added complete `admit_props` extraction for WordPress prop checklists, including final entries without trailing commas.
- Kept prompts for earlier selected file groups together before routed-output questions.
- Aligned associative-array arrows in generated WordPress story defaults.
- Existing destination files are now always preserved and reported together in one skipped-file warning while non-conflicting output continues.
- File-selection checklists now start completely unselected when any initially selected option already has a file in the target.
- Existing-file reports now use a non-blocking warning, and prompts used only by skipped outputs are omitted.
- Existing-file alerts display skipped paths as a bulleted list.
- Existing-file alerts are confirmed before forge progress begins and non-conflicting output is generated.

## 0.4.1

- Standalone conditional directive lines are removed so control syntax does not introduce blank lines in generated output.

## 0.4.0

- Added structurally parsed `if`, `elseif`, and `else` blocks for UTF-8 template contents.
- Added a safe condition language with typed literals, strict comparisons, logical keywords, parentheses, and explicit truthiness rules.
- Added conditions for built-ins, prompts, raw confirm booleans, collections, custom placeholders, loop fields, and loop metadata.
- Added staged, branch-aware dependency resolution so inactive bodies and later unreachable branches do not prompt, scan, extract, or validate semantic placeholders.

## 0.3.0

- Added dependency-aware filesystem and extract collections with safe source scopes, filtering, recursion, sorting, and empty behaviors.
- Added built-in regex and AST-based JavaScript/TypeScript prop extractors, declarative presets, and trusted custom CommonJS extractors.
- Added native single- and multi-select collection prompts, record field placeholders, nested template loops, aliases, and loop metadata.
- Added extractor management commands, limited untrusted-workspace support, comprehensive documentation, examples, and regression coverage.

## 0.2.0

- Added optional version 1 `blueprint.json` manifests with Quick Pick metadata.
- Added recursive custom placeholders and six native interactive prompt types.
- Added required, default-selected, literal-path, and glob-based output selection.
- Added dependency-aware prompting so unselected outputs are not inspected.

## 0.1.0

- Initial release of File Foundry.
- Added local blueprint discovery and recursive forging.
- Added context placeholders and eleven case transformations.
- Added safe preflight validation, binary copying, and operation-level conflict handling.
