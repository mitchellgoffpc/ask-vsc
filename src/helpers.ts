import os from 'os';
import path from 'path';
import * as vscode from 'vscode';

export function resolveFileURI(filename: string): vscode.Uri {
    let rootDir = path.parse(process.cwd()).root;
    let workspaceDirs = vscode.workspace.workspaceFolders;
    let fullPath = filename.startsWith(rootDir) ? filename :
                   workspaceDirs                ? path.join(workspaceDirs[0].uri.path, filename) :
                                                  path.join(os.homedir(), filename);
    return vscode.Uri.file(fullPath);
}

export function getSelectedText(editor: vscode.TextEditor | undefined): string | null {
    return editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : null;
}

export function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}