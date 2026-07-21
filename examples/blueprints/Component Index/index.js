[[#each Prompt:SelectedComponents as Component]]
export { default as [[Component:name>PascalCase]] } from './[[Component:relativePath]]';
[[/each]]
