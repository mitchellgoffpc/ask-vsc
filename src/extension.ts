import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import * as Diff from 'diff';
import { MODELS, Model } from './api/models';
import { APIKeyError, APIResponseError, query } from './api/query';

const SYSTEM_PROMPT =
  "You are CodeGPT, a world-class AI designed to help write and debug code. " +
  "Whenever you are asked to write code, you should return only the code, " +
  "with no additional context or messages.";
const CODE_PROMPT =
  "The following is some code that I'm currently working on. " +
  "It may be relevant to help answer my questions.";
const INSERT_PROMPT =
  "The code you write will be inserted in my code where it says 'TODO: WRITE CODE HERE'.";
const POST_PROMPT = "Please remember to return just the code, with no additional context or explanations.";

type Document = vscode.TextDocument | vscode.NotebookDocument;
type Message = {
    type: "prompt" | "code";
    value: string | null;
    name?: string;
};


// Helper functions

async function* accumulate(iterable: AsyncIterable<string>): AsyncIterable<string> {
    let result = "";
    for await (let value of iterable) {
        result += value;
        yield result;
    }
}

async function* lines(iterable: AsyncIterable<string>): AsyncIterable<string> {
    let currentLine = "";
    for await (let value of iterable) {
        currentLine += value;
        if (currentLine.includes('\n')) {
            let lines = currentLine.split('\n');
            for (let line of lines.slice(0, -1)) {
                yield line + '\n';
            }
            currentLine = lines[lines.length - 1];
        }
    }
    if (currentLine) {
        yield currentLine;
    }
}

async function* removeBackticks(iterable: AsyncIterable<string>): AsyncIterable<string> {
    let inBackticks = null;
    for await (let value of iterable) {
        if (inBackticks === null && value.startsWith('```')) {  // First line
            inBackticks = true;
        } else if (inBackticks === null) {
            inBackticks = false;
            yield value;
        } else if (inBackticks && value.startsWith('```')) {
            break;
        } else {
            yield value;
        }
    }
}

function addTrailingNewline(text: string): string {
    return text.endsWith('\n') ? text : text + '\n';
}

function getIndentationLevel(text: string): number {
    const lines = text.split('\n');
    const indentations = lines.map(line => line.search(/\S/))
                              .filter(indent => indent !== -1);
    return indentations.length ? Math.min(...indentations) : 0;
}

function applyIndentationLevel(text: string, indentationLevel: number): string {
    const currentIndentationLevel = getIndentationLevel(text);
    if (currentIndentationLevel >= indentationLevel) {
        return text;
    } else {
        const indentation = " ".repeat(indentationLevel - currentIndentationLevel);
        return text.split('\n').map(line => indentation + line).join('\n');
    }
}

function isNotebookDocument(document: Document): document is vscode.NotebookDocument {
    return typeof document !== 'undefined' && 'cellCount' in document;
}
function isTextDocument(document: Document): document is vscode.TextDocument {
    return typeof document !== 'undefined' && 'lineCount' in document;
}
function isValidTab(tabInput: unknown): tabInput is vscode.TabInputText | vscode.TabInputNotebook {
    return typeof tabInput !== 'undefined' && (tabInput instanceof vscode.TabInputText || tabInput instanceof vscode.TabInputNotebook);
}

function resolveFileURI(filename: string): vscode.Uri {
    let rootDir = path.parse(process.cwd()).root;
    let workspaceDirs = vscode.workspace.workspaceFolders;
    let fullPath = filename.startsWith(rootDir) ? filename :
                   workspaceDirs                ? path.join(workspaceDirs[0].uri.path, filename) :
                                                  path.join(os.homedir(), filename);
    return vscode.Uri.file(fullPath);
}

async function openDocumentFromTab(tab: vscode.Tab): Promise<Document | undefined> {
    if (tab && tab.input instanceof vscode.TabInputText) {
        return await vscode.workspace.openTextDocument(tab.input.uri);
    } else if (tab && tab.input instanceof vscode.TabInputNotebook) {
        return await vscode.workspace.openNotebookDocument(tab.input.uri);
    } else {
        return undefined;
    }
}

function getBufferText(document: vscode.TextDocument, selection: vscode.Selection | undefined, addInsertionPoint: boolean = false): string {
    const text = document.getText();
    if (addInsertionPoint && selection && selection.isEmpty) {
        const offset = document.offsetAt(selection.active);
        return text.slice(0, offset) + "TODO: WRITE CODE HERE" + text.slice(offset);
    } else {
        return text;
    }
}

function getCellText(cell: vscode.NotebookCell, editor: vscode.TextEditor | undefined, addInsertionPoint: boolean): string {
    const cellIsActive = cell.document === editor?.document;
    const cellText = getBufferText(cell.document, editor?.selection, cellIsActive && addInsertionPoint);
    if (cell.kind === vscode.NotebookCellKind.Markup) {
        return `"""\n${cellText}\n"""`;  // TODO: Make this work for non-python code
    } else {
        return cellText;
    }
}

function getDocumentText(document: Document, editor: vscode.TextEditor | undefined, addInsertionPoint: boolean = false): string {
    if (isNotebookDocument(document)) {
        return document.getCells().map(cell => getCellText(cell, editor, addInsertionPoint)).join("\n\n");
    } else {
        return getBufferText(document, editor?.selection, addInsertionPoint);
    }
}

async function getCodeMessages(question: string, activeDocument: Document | undefined, editor: vscode.TextEditor | undefined, addInsertionPoint: boolean = false): Promise<Message[]> {
    let tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    let tags = question.match(/@workspace\b|@tab\s+\S+|@file\s+\S+/g) || [];
    let documents: Map<string, Document | undefined> = new Map();
    if (activeDocument) {
        documents.set(activeDocument.uri.path, activeDocument);
    }

    for (let tag of tags) {
        if (tag.startsWith("@file")) {
            let uri = resolveFileURI(tag.split(/\s+/)[1]);
            documents.set(uri.path, await vscode.workspace.openTextDocument(uri));
        } else if (tag.startsWith("@tab")) {
            let tab = tabs.find(tab => tab.label === tag.split(/\s+/)[1]);
            if (isValidTab(tab?.input)) {
                documents.set(tab.input.uri.path, await openDocumentFromTab(tab));
            }
        } else if (tag.startsWith("@workspace")) {
            for (let tab of tabs) {
                if (isValidTab(tab?.input)) {
                    documents.set(tab.input.uri.path, await openDocumentFromTab(tab));
                }
            }
        }
    }

    let messages: Message[] = [];
    for (let [path, document] of documents) {
        if (document) {
            messages.push({ type: "code", name: path, value: getDocumentText(document, editor, addInsertionPoint) });
        }
    }
    return messages;
}

function getSelectedText(editor: vscode.TextEditor | undefined): [vscode.Range, string | null] {
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

function removeTags(text: string): string {
    return text.replace(/@workspace\b|@tab\s+\S+|@file\s+\S+/g, "").trim();
}

function formatMessage(message: Message): string | null {
    return message.value === null    ? null :
           message.type === "prompt" ? message.value :
           message.type === "code"   ? (message.name ? `${message.name}\n` : "") + "```\n" + message.value + "\n```" :
                                       null;
}

function createPrompt(messages: Message[]): string {
    const filteredMessages = messages.map(formatMessage).filter(message => message !== null);
    return filteredMessages.join("\n\n");
}


// API functions

async function* ask(question: string, model: Model, controller: AbortController): AsyncIterable<string> {
    const activeEditor = vscode.window.activeTextEditor;
    const activeDocument = vscode.window.activeNotebookEditor?.notebook || activeEditor?.document;
    if (question) {
        const [_, selectedText] = getSelectedText(activeEditor);
        const prompt = createPrompt([
            { type: "prompt", value: CODE_PROMPT },
            ...await getCodeMessages(question, activeDocument, activeEditor),
            { type: "prompt", value: "Now, please answer the following question:" },
            { type: "code",   value: selectedText },
            { type: "prompt", value: removeTags(question) }
        ]);
        yield* accumulate(query(prompt, model, controller));
    } else {
        yield "";
    }
}

async function* modify(question: string, model: Model, controller: AbortController): AsyncIterable<Diff.Change[]> {
    const activeEditor = vscode.window.activeTextEditor;
    const activeDocument = vscode.window.activeNotebookEditor?.notebook || activeEditor?.document;
    if (question && activeEditor) {
        const [selectedRange, selectedText] = getSelectedText(activeEditor);
        const indentationLevel = selectedText ? getIndentationLevel(selectedText) : activeEditor.selection.start.character;

        const commonMessages: Message[] = [
            { type: "prompt", value: SYSTEM_PROMPT },
            { type: "prompt", value: CODE_PROMPT },
            ...await getCodeMessages(question, activeDocument, activeEditor, true),
        ];
        const actionMessages: Message[] = selectedText ? [
            { type: "prompt", value: "Your task is to modify the following code (and ONLY the following code) as described below:" },
            { type: "code",   value: selectedText },
            { type: "prompt", value: `${removeTags(question)} ${POST_PROMPT}` }
        ] : [
            { type: "prompt", value: "Your task is as follows:" },
            { type: "prompt", value: `${removeTags(question)} ${INSERT_PROMPT} ${POST_PROMPT}` }
        ];

        const prompt = createPrompt([...commonMessages, ...actionMessages]);

        let finalDiff: Diff.Change[] = [];
        for await (let update of accumulate(removeBackticks(lines(query(prompt, model, controller))))) {
            update = applyIndentationLevel(update, indentationLevel);
            let diff = Diff.diffLines(addTrailingNewline(selectedText || ""), addTrailingNewline(update));
            finalDiff = diff.slice();
            while (diff.length && diff[diff.length - 1].removed) {
                diff.pop();  // Don't show trailing removed lines until the end
            }
            yield diff;
        }
        yield finalDiff;
    } else {
        yield [];
    }
}


// Ask sidebar

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

class ChatViewProvider implements vscode.WebviewViewProvider {
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


// Register commands

export function activate(context: vscode.ExtensionContext) {
    const chatViewProvider = new ChatViewProvider(context);

    context.subscriptions.push(vscode.commands.registerCommand('ask.ask', chatViewProvider.ask));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('ask.chat-view', chatViewProvider));
}
export function deactivate() {}
