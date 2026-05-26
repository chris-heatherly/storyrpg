const appJson = require('./app.json');
const target = process.env.STORYRPG_APP_TARGET || 'reader';

export default {
  ...appJson.expo,
  name: target === 'generator' ? 'StoryRPG Generator' : 'StoryRPG Reader',
  slug: target === 'generator' ? 'storyrpg-generator' : 'storyrpg-reader',
  extra: {
    appTarget: target,
    posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
    posthogHost: process.env.POSTHOG_HOST,
  },
};
