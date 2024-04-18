import os from 'os';
import path from 'path';
import * as vscode from 'vscode';

export type Document = vscode.TextDocument | vscode.NotebookDocument;

export function isNotebookDocument(document: Document): document is vscode.NotebookDocument {
    return typeof document !== 'undefined' && 'cellCount' in document;
}
export function isTextDocument(document: Document): document is vscode.TextDocument {
    return typeof document !== 'undefined' && 'lineCount' in document;
}
export function isValidTab(tabInput: unknown): tabInput is vscode.TabInputText | vscode.TabInputNotebook {
    return typeof tabInput !== 'undefined' && (tabInput instanceof vscode.TabInputText || tabInput instanceof vscode.TabInputNotebook);
}

export async function openDocumentFromTab(tab: vscode.Tab): Promise<Document | undefined> {
    if (tab && tab.input instanceof vscode.TabInputText) {
        return await vscode.workspace.openTextDocument(tab.input.uri);
    } else if (tab && tab.input instanceof vscode.TabInputNotebook) {
        return await vscode.workspace.openNotebookDocument(tab.input.uri);
    } else {
        return undefined;
    }
}

export function getSelectedText(editor: vscode.TextEditor | undefined): string | null {
    return editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : null;
}

export function resolveFileURI(filename: string): vscode.Uri {
    let rootDir = path.parse(process.cwd()).root;
    let workspaceDirs = vscode.workspace.workspaceFolders;
    let fullPath = filename.startsWith(rootDir) ? filename :
                   workspaceDirs                ? path.join(workspaceDirs[0].uri.path, filename) :
                                                  path.join(os.homedir(), filename);
    return vscode.Uri.file(fullPath);
}

export function getLocalPath(uriPath: string): string {
    let workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.path;
    return workspaceDir && uriPath.startsWith(workspaceDir)
      ? uriPath.slice(workspaceDir.length + 1)
      : uriPath;
}

export async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch (error) {
        return false;
    }
}

export async function createFile(uri: vscode.Uri, content: string) {
    if (!await fileExists(uri)) {
        try {
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
            await vscode.window.showTextDocument(uri);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not create file: ${uri.path}. ${error}`);
        }
    } else {
        vscode.window.showErrorMessage(`File already exists: ${uri.path}`);
    }
}

export async function deleteFile(uri: vscode.Uri) {
    if (await fileExists(uri)) {
        try {
            await vscode.workspace.fs.delete(uri);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not delete file: ${uri.path}. ${error}`);
        }
    } else {
        vscode.window.showErrorMessage(`File does not exist: ${uri.path}`);
    }
}

export function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
