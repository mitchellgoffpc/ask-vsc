//@ts-check
'use strict';

const path = require('path');
const glob = require('glob');

/**@type {import('webpack').Configuration}*/
const extConfig = {
  target: 'node',
  devtool: 'source-map',
  entry: './src/extension.ts',
  output: {
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    path: path.resolve(__dirname, 'out'),
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: { rules: [{ test: /\.ts$/, loader: 'ts-loader' }] },
  externals: { vscode: 'vscode' },
};

/**@type {import('webpack').Configuration}*/
const webviewConfig = {
  target: 'web',
  devtool: 'source-map',
  entry: './src/webview/index.tsx',
  output: {
    filename: '[name].wv.js',
    path: path.resolve(__dirname, 'out'),
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx'],
  },
  module: {
    rules: [
      { test: /\.tsx?$/, use: ['ts-loader'] },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
};

/**@type {import('webpack').Configuration}*/
const testConfig = {
  target: 'node',
  entry: glob.sync("./test/**/*.test.ts").map(f => path.resolve(__dirname, f)),
  output: {
    filename: '[name].test.js',
    path: path.resolve(__dirname, 'out')
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: { rules: [{ test: /\.ts$/, loader: 'ts-loader' }] },
  externals: { vscode: 'vscode' },
};

module.exports = [extConfig, webviewConfig, testConfig];
