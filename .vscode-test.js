const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
    {
        label: 'unitTests',
        files: 'out/main.test.js',
    }
]);