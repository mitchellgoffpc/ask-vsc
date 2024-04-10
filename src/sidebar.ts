import path from 'path';
import * as vscode from 'vscode';
import * as Diff from 'diff';
import { MODELS, Model } from './api/models';
import { APIKeyError, APIResponseError } from './api/query';
import { resolveFileURI, getSelectedText } from './helpers';
import { ask, modify } from './prompt';


function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export default class ChatViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private controller: AbortController = new AbortController();

    constructor(private context: vscode.ExtensionContext) { }

    ask = () => {
        vscode.commands.executeCommand('ask.chat-view.focus');
        this.view?.webview.postMessage({ command: 'focus' });
    };

    getModel(): Model {
        const modelID = this.context.workspaceState.get<string>('modelID');
        return MODELS.find(model => model.id === modelID) || MODELS[0];
    }
    async setModel(modelName: string) {
        const model = MODELS.find(model => model.name === modelName) || MODELS[0];
        await this.context.workspaceState.update('modelID', model.id);
    }

    abortRequest() {
        this.controller.abort();
        this.controller = new AbortController();
    }

    handleMessage = async (data: any) => {
        if (data.command === 'submit') {
            await this.handleSubmit(data.value, data.isModification);
        } else if (data.command === "approve") {
            await this.handleApproveDiff(data.diff);
        } else if (data.command === "model") {
            this.setModel(data.value);
        } else if (data.command === "getstate") {
            this.view?.webview.postMessage({ command: 'state', value: { model: this.getModel() }});
        } else if (data.command === 'gettabs') {
            const tabGroups = vscode.window.tabGroups.all;
            const tabNames = tabGroups.flatMap(group => group.tabs.map(tab => tab.label));
            this.view?.webview.postMessage({ command: 'gettabs', value: tabNames });
        } else if (data.command === "getfiles") {
            let prefix = data.value.slice(0, data.value.lastIndexOf(path.sep) + 1);
            let uri = resolveFileURI(prefix);
            try {
                await vscode.workspace.fs.stat(uri);  // Stat first to check if the file exists
                const files = await vscode.workspace.fs.readDirectory(uri);
                const filePaths = files
                    .filter(x => !x[0].startsWith('.'))
                    .map(([filename, type]) => [`${prefix}${filename}`, type === vscode.FileType.Directory]);
                this.view?.webview.postMessage({ command: 'getfiles', value: filePaths });
            } catch (error) {
                this.view?.webview.postMessage({ command: 'getfiles', value: [] });
            }
        } else if (data.command === "unfocus") {
            vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        }
    };

    async handleSubmit(message: string, isModification: boolean) {
        try {
            this.abortRequest();
            this.view?.webview.postMessage({ command: 'clear' });
            this.view?.webview.postMessage({ command: 'message', role: "user", value: message });
            this.view?.webview.postMessage({ command: 'message', role: "agent", value: "" });
            if (isModification) {
                for await (let update of modify(message, this.getModel(), this.controller)) {
                    this.view?.webview.postMessage({ command: 'message-update', role: "agent", diff: update });
                }
            } else {
                for await (let update of ask(message, this.getModel(), this.controller)) {
                    this.view?.webview.postMessage({ command: 'message-update', role: "agent", value: update });
                }
            }
            this.view?.webview.postMessage({ command: 'message-done' });
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

    async handleApproveDiff(diff: Diff.Change[]) {
        this.view?.webview.postMessage({ command: 'clear' });
        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            let [selectedRange, _] = getSelectedText(activeEditor);
            let replacement = diff
                .filter((change: Diff.Change) => !change.removed)
                .map((change: Diff.Change) => change.value)
                .join('');
            activeEditor.edit(editBuilder => {
                editBuilder.replace(selectedRange, replacement);
            });
            vscode.window.showTextDocument(activeEditor.document, activeEditor.viewColumn);
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
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'main.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();

        return `
            <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">

                    <link href="${styleUri}" rel="stylesheet">
                    <link href="${codiconsUri}" rel="stylesheet">
                </head>
                <body>
                    <div class="chat-output"></div>

                    <div class="chat-input">
                        <div class="settings">
                            <div class="model-select">
                                <span class="model-name"></span>
                                <i class="codicon codicon-chevron-up"></i>
                                <div class="model-options">
                                    ${MODELS.map(model =>`<div data-value="${model.name}">${model.name}</div>`).join('')}
                                </div>
                            </div>
                        </div>
                        <div class="input-box">
                            <textarea placeholder="Ask a question!" class="message"></textarea>
                            <div class="submit">
                                <i class="codicon codicon-send"></i>
                            </div>
                            <div class="autocomplete"></div>
                        </div>
                    </div>

                    <script nonce="${nonce}">exports = {};</script>
                    <script nonce="${nonce}" src="${scriptUri}"></script>
                </body>
            </html>`;
    }
}
