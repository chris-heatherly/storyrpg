module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            'fs/promises': './src/fs-promises-polyfill.js',
            'node:fs/promises': './src/fs-promises-polyfill.js',
            'fs': './src/fs-polyfill.js',
            'node:fs': './src/fs-polyfill.js',
            'path': './src/path-polyfill.js',
            'node:path': './src/path-polyfill.js',
            'os': 'os-browserify/browser',
            'crypto': 'crypto-browserify',
            'stream': 'stream-browserify',
            'buffer': 'buffer',
          },
        },
      ],
    ],
  };
};
