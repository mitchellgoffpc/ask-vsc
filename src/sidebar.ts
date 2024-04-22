import path from 'path';
import * as vscode from 'vscode';
import * as Diff from 'diff';
import { MODELS, Model } from './api/models';
import { APIKeyError, APIResponseError } from './api/query';
import { Document, isNotebookDocument, isValidTab, resolveFileURI, getNonce, openDocumentFromTab, createFile, deleteFile, fileExists } from './helpers';
import { ask } from './query';
import { Store } from './store';

const COMMANDS = ["/file", "/tab"];


export default class ChatViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private store: Store;
    private controller: AbortController = new AbortController();

    constructor(private context: vscode.ExtensionContext) {
        this.store = new Store(context);
    }

    ask = () => {
        vscode.commands.executeCommand('ask.chat-view.focus');
        this.view?.webview.postMessage({ action: 'focus' });
    };

    abortRequest() {
        this.controller.abort();
        this.controller = new AbortController();
    }

    handleMessage = async (data: any) => {
        if (data.action === 'submit') {
            await this.store.pushHistory(data.value);
            this.view?.webview.postMessage({ action: 'state', value: this.store.getState(), resetHistory: true });
            await this.handleSubmit(data.value);
        } else if (data.action === "approve") {
            await this.handleApproveDiff(data.diff);
        } else if (data.action === "setmodel") {
            await this.store.setModel(data.value);
            this.view?.webview.postMessage({ action: 'state', value: this.store.getState() });
        } else if (data.action === "getstate") {
            this.view?.webview.postMessage({ action: 'state', value: this.store.getState(), resetHistory: true });
        } else if (data.action === 'gettabs') {
            const tabGroups = vscode.window.tabGroups.all;
            const tabNames = tabGroups.flatMap(group => group.tabs.map(tab => tab.label));
            this.view?.webview.postMessage({ action: 'gettabs', value: tabNames });
        } else if (data.action === "getfiles") {
            let prefix = data.value.slice(0, data.value.lastIndexOf(path.sep) + 1);
            let uri = resolveFileURI(prefix);
            try {
                await vscode.workspace.fs.stat(uri);  // Stat first to check if the file exists
                const files = await vscode.workspace.fs.readDirectory(uri);
                const filePaths = files
                    .filter(x => !x[0].startsWith('.'))
                    .map(([filename, type]) => ({path: `${prefix}${filename}`, isDir: type === vscode.FileType.Directory}));
                this.view?.webview.postMessage({ action: 'getfiles', value: filePaths });
            } catch (error) {
                this.view?.webview.postMessage({ action: 'getfiles', value: [] });
            }
        } else if (data.action === "removefile") {
            await this.store.removeFile(resolveFileURI(data.value));
            this.view?.webview.postMessage({ action: 'state', value: this.store.getState() });
        } else if (data.action === "unfocus") {
            vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        } else if (data.action === "command") {
            if (!COMMANDS.includes(data.command)) {
                vscode.window.showErrorMessage(`Unknown command: ${data.command}`);
            } else if (data.args.length === 0) {
                vscode.window.showErrorMessage("Command '/file' requires a file path as an argument");
            } else if (data.command === "/file") {
                let uri = resolveFileURI(data.args[0]);
                if (await fileExists(uri)) {
                    await this.store.addFile(uri);
                    this.view?.webview.postMessage({ action: 'state', value: this.store.getState() });
                } else {
                    vscode.window.showErrorMessage(`File not found: ${uri.path}`);
                }
            } else if (data.command === "/tab") {
                let tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
                let tab = tabs.find(tab => tab.label === data.args[0]);
                if (isValidTab(tab?.input)) {
                    await this.store.addFile(tab.input.uri);
                    this.view?.webview.postMessage({ action: 'state', value: this.store.getState() });
                } else {
                    vscode.window.showErrorMessage(`Tab not found: ${data.args[0]}`);
                }
            }
        }
    };

    async handleSubmit(message: string) {
        try {
            this.abortRequest();
            await this.store.setMessages([{role: 'user', content: message}, {role: 'agent', content: ''}]);
            await this.view?.webview.postMessage({ action: 'state', value: this.store.getState() });
            for await (let update of ask(message, this.store.getFiles(), this.store.getModel(), this.controller)) {
                await this.store.setMessages([{role: 'user', content: message}, {role: 'agent', content: update}]);
                await this.view?.webview.postMessage({ action: 'state', value: this.store.getState() });
            }
        } catch (error: any) {
            if (error instanceof APIKeyError) {
                vscode.window.showErrorMessage(error.message, {}, {title: "Settings"}, {title: "Cancel"}).then(selection => {
                    if (selection?.title === "Settings") {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'ask.apiKeys');
                    }
                });
            } else if (error instanceof APIResponseError) {
                vscode.window.showErrorMessage(error.message);  // TODO: Show the entire error message
            } else {
                throw error;
            }
        }
    }

    async handleApproveDiff(diff: string) {
        const parsedDiff = Diff.parsePatch(diff);
        const changes = parsedDiff.flatMap(file => {
            let oldFileURI = file.oldFileName ? resolveFileURI(file.oldFileName) : undefined;
            let newFileURI = file.newFileName ? resolveFileURI(file.newFileName) : undefined;
            if (file.hunks.length) {
                return file.hunks.map(hunk => {
                    let delimiters = hunk.linedelimiters || [];
                    let lines = hunk.lines.map((line, i) => ({line, delimiter: delimiters[i] || '\n'}));
                    let search = lines.filter(({line}) => line[0] !== '+').map(({line, delimiter}) => line.slice(1) + delimiter).join('');
                    let replace = lines.filter(({line}) => line[0] !== '-').map(({line, delimiter}) => line.slice(1) + delimiter).join('');
                    let searchTrailingNewlines = search.match(/\n*$/) || [[]];
                    let replaceTrailingNewlines = replace.match(/\n*$/) || [[]];
                    let endPos = -Math.min(searchTrailingNewlines[0].length, replaceTrailingNewlines[0].length) || undefined;
                    return { oldFileURI, newFileURI, search: search.slice(0, endPos), replace: replace.slice(0, endPos) };
                });
            } else {
                return [{ oldFileURI, newFileURI, search: '', replace: '' }];
            }
        });

        let tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
        let tabsByFilePath: {[key: string]: vscode.Tab} = {};
        for (let tab of tabs) {
            if (isValidTab(tab.input)) {
                tabsByFilePath[tab.input.uri.path] = tab;
            }
        }

        for (let change of changes) {
            if (!change.oldFileURI || !change.newFileURI) {
                vscode.window.showErrorMessage(`Could not apply diff: missing file path.`);
            } else if (change.oldFileURI.path === '/dev/null') {
                createFile(change.newFileURI, change.replace);
            } else if (change.newFileURI.path === '/dev/null') {
                if (change.oldFileURI.path in tabsByFilePath) {
                    let document = await openDocumentFromTab(tabsByFilePath[change.oldFileURI.path]);
                    if (!document) {
                        continue;
                    }
                    if (isNotebookDocument(document)) {
                        await vscode.window.showNotebookDocument(document);
                    } else {
                        await vscode.window.showTextDocument(document);
                    }
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
                deleteFile(change.oldFileURI);
            } else {
                let document = await openDocumentFromTab(tabsByFilePath[change.newFileURI.path]);
                if (!document) {
                    vscode.window.showErrorMessage(`Could not apply diff: file not found in workspace.`);
                } else if (change.search !== change.replace) {
                    if (isNotebookDocument(document)) {
                        await vscode.window.showNotebookDocument(document);
                    } else {
                        await vscode.window.showTextDocument(document);
                    }

                    let activeEditor = vscode.window.activeTextEditor;
                    if (!activeEditor) { continue; }

                    let text = activeEditor.document.getText();
                    let startIndex = [
                        text.indexOf(change.search),
                        text.indexOf(change.search.replace(/^\n+/g, '')),
                        text.indexOf(change.search.replace(/\n+$/g, '')),
                    ].find(index => index !== -1);

                    if (typeof startIndex === 'undefined') {
                        vscode.window.showErrorMessage("Could not apply diff: search text not found in document.");
                    } else {
                        const endIndex = startIndex + change.search.length;
                        const start = activeEditor.document.positionAt(startIndex);
                        const end = activeEditor.document.positionAt(endIndex);
                        const range = new vscode.Range(start, end);
                        activeEditor.edit(editBuilder => {
                            editBuilder.replace(range, change.replace);
                        });
                    }
                }
            }
        }
    }

    resolveWebviewView(
        view: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ) {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };
        view.webview.html = this.getHtmlForWebview(view.webview);
        view.webview.onDidReceiveMessage(this.handleMessage);
    }

    getHtmlForWebview(webview: vscode.Webview): string {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'main.wv.js'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();

        return `
            <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">

                    <link href="${codiconsUri}" rel="stylesheet">
                </head>
                <body>
                    <div id="root"></div>

                    <script nonce="${nonce}" src="${scriptUri}"></script>
                </body>
            </html>`;
    }
}
