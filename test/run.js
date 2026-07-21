'use strict';

require('./placeholders.test');
require('./filesystem.test');
require('./forge.test');
require('./blueprint-usage.test');
require('./manifest.test');
require('./extended-placeholders.test');
require('./selection.test');
require('./prompts.test');
require('./selected-output.test');
require('./collections.test');
require('./extractors.test');
require('./collection-templates.test');
require('./collection-prompts.test');
require('./collection-manifest.test');
require('./conditions.test');
require('./conditional-templates.test');
require('./workspace-edits.test');
require('./output-routes.test');
require('./readme.test');

const { run } = require('./harness');

run();
