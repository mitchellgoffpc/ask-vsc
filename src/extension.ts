import * as vscode from 'vscode';
import ChatViewProvider from './sidebar';

export function activate(context: vscode.ExtensionContext) {
    const chatViewProvider = new ChatViewProvider(context);
    context.subscriptions.push(vscode.commands.registerCommand('ask.ask', chatViewProvider.ask));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('ask.chat-view', chatViewProvider));
}
export function deactivate() {}
