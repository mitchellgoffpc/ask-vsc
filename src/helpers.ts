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

export function getSelectedText(editor: vscode.TextEditor | undefined): [vscode.Range, string | null] {
    if (!editor) {
        return [new vscode.Range(0, 0, 0, 0), null];
    } else if (editor.selection.isEmpty) {
        return [editor.document.lineAt(editor.selection.active.line).range, null];
    } else {
        const startLine = editor.document.lineAt(editor.selection.start.line);
        const endLine = editor.document.lineAt(editor.selection.end.line);
        const selectionRange = new vscode.Range(startLine.range.start, endLine.range.end);
        return [selectionRange, editor.document.getText(selectionRange)];
    }
}