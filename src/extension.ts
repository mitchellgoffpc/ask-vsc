import * as vscode from 'vscode';
import * as fs from 'fs';
import * as child_process from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "ask-vsc" is now active!');

    context.subscriptions.push(vscode.commands.registerCommand('ask-vsc.ask', () => {
        vscode.window.showInputBox({ prompt: 'Enter your question' }).then(question => {
            if (question) {
                fs.writeFileSync('/tmp/.message', question);
                child_process.exec('cat /tmp/.message | ask', (error, stdout, stderr) => {
                    vscode.window.showInformationMessage(stdout);
                });
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('ask-vsc.modify', () => {
        vscode.window.showInputBox({ prompt: 'Enter your question' }).then(question => {
            if (question) {
                fs.writeFileSync('/tmp/.message', question);
                child_process.exec('cat /tmp/.message | ask', (error, stdout, stderr) => {
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor) {
                        const selection = activeEditor.selection;
                        const selectedText = activeEditor.document.getText(selection);
                        vscode.workspace.openTextDocument({ content: stdout }).then(doc => {
                            vscode.commands.executeCommand('vscode.diff',
                                activeEditor.document.uri,
                                doc.uri,
                                `Diff: Original vs. Modified`,
                                { preview: true, viewColumn: vscode.ViewColumn.Beside }
                            );
                        }).then(() => {
                            vscode.commands.registerCommand('type', (event) => {
                                if (event.text === '\n') {
                                    vscode.window.showInformationMessage("yay");
                                }
                            });
                        });
                    }
                });
            }
        });
    }));
}

export function deactivate() {}
