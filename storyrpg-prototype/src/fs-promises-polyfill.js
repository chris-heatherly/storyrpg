/**
 * Polyfill for `require('fs/promises')` in the React Native web bundle.
 * Re-exports the promises object from fs-polyfill.js.
 */
const fs = require('./fs-polyfill');
module.exports = fs.promises;
