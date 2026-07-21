'use strict';

module.exports = {
  id: 'user.todoComments',
  name: 'TODO Comments',
  apiVersion: 1,
  supportedExtensions: ['js', 'jsx', 'ts', 'tsx'],

  async extract({ content }) {
    return content.split(/\r?\n/u).flatMap((line, index) => {
      const marker = line.indexOf('TODO:');
      return marker === -1 ? [] : [{
        text: line.slice(marker + 5).trim(),
        line: index + 1
      }];
    });
  }
};
