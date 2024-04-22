//@ts-check
'use strict';

const path = require('path');

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

module.exports = [extConfig, webviewConfig];
