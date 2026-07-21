import Component from './[[FolderName>PascalCase]]';

export default {
  component: Component
};

export const Default = {
  args: {
[[#each Prompt:SelectedProps as Prop]]
    [[Prop:name]]: undefined[[#if not Prop:@last]],[[/if]]
[[/each]]
  }
};
