import * as vscode from 'vscode';
import * as Diff from 'diff';
import { query } from './api/query';
import { MODELS } from './api/models';

const SYSTEM_PROMPT =
  "You are CodeGPT, a world-class AI designed to help write and debug code. " +
  "Whenever you are asked to write code, you should return only the code, " +
  "with no additional context or messages.";
const CODE_PROMPT =
  "The following is a file that I'm currently working on. " +
  "It may be relevant to help answer my questions.";
const INSERT_PROMPT =
  "The code you write will be inserted in my code where it says 'TODO: WRITE CODE HERE'.";
const POST_PROMPT = "Please remember to return just the code, with no additional context or explanations.";

type Message = {
    type: "prompt" | "code";
    value: string | null;
};


// Helper functions

function removeTrailingNewlines(input: string): string {
    return input.replace(/\n+$/, '');
}

function removeBackticks(input: string): string {
    const startIndex = input.indexOf("```");
    const lastIndex = input.lastIndexOf("```");
    if (startIndex !== -1 && lastIndex !== startIndex) {
        return input.slice(input.indexOf('\n', startIndex) + 1, lastIndex);
    } else {
        return input;
    }
}

function getTextWithPoint(editor: vscode.TextEditor): string {
    const text = editor.document.getText();
    if (editor.selection.isEmpty) {
        const offset = editor.document.offsetAt(editor.selection.active);
        return text.slice(0, offset) + "TODO: WRITE CODE HERE" + text.slice(offset);
    } else {
        return text;
    }
}

function getSelectedText(editor: vscode.TextEditor): [vscode.Range, string | null] {
    if (editor.selection.isEmpty) {
        return [editor.document.lineAt(editor.selection.active.line).range, null];
    } else {
        const startLine = editor.document.lineAt(editor.selection.start.line);
        const endLine = editor.document.lineAt(editor.selection.end.line);
        const selectionRange = new vscode.Range(startLine.range.start, endLine.range.end);
        return [selectionRange, editor.document.getText(selectionRange)];
    }
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

function formatMessage(message: Message): string | null {
    return message.value === null    ? null :
           message.type === "prompt" ? message.value :
           message.type === "code"   ? "```\n" + message.value + "\n```" :
                                       null;
}

function createPrompt(messages: Message[]): string {
    const filteredMessages = messages.map(formatMessage).filter(message => message !== null);
    return filteredMessages.join("\n\n");
}


// API functions

async function* ask(question: string): AsyncIterable<string> {
    const activeEditor = vscode.window.activeTextEditor;
    if (question && activeEditor) {
        const [_, selectedText] = getSelectedText(activeEditor);
        const prompt = createPrompt([
            { type: "prompt", value: CODE_PROMPT },
            { type: "code",   value: activeEditor.document.getText() || null },
            { type: "prompt", value: "Now, please answer the following question:" },
            { type: "code",   value: selectedText },
            { type: "prompt", value: question }
        ]);
        yield* query(prompt, MODELS[0]);
    } else {
        yield "";
    }
}

async function modify(question: string): Promise<Diff.Change[]> {
    const activeEditor = vscode.window.activeTextEditor;
    if (question && activeEditor) {
        const [selectedRange, selectedText] = getSelectedText(activeEditor);
        const indentationLevel = selectedText ? getIndentationLevel(selectedText) : activeEditor.selection.start.character;

        const commonMessages: Message[] = [
            { type: "prompt", value: SYSTEM_PROMPT },
            { type: "prompt", value: CODE_PROMPT },
            { type: "code",   value: getTextWithPoint(activeEditor) }
        ];
        const actionMessages: Message[] = selectedText ? [
            { type: "prompt", value: "Your task is to modify the following code (and ONLY the following code) as described below:" },
            { type: "code",   value: selectedText },
            { type: "prompt", value: question + " " + POST_PROMPT }
        ] : [
            { type: "prompt", value: "Your task is as follows:" },
            { type: "prompt", value: question + " " + INSERT_PROMPT + " " + POST_PROMPT }
        ];

        const prompt = createPrompt([...commonMessages, ...actionMessages]);

        let response = '';
        for await (let token of query(prompt, MODELS[0])) {
            response += token;
        }
        const replacement = applyIndentationLevel(removeTrailingNewlines(removeBackticks(response)), indentationLevel);
        return Diff.diffLines(selectedText || "", replacement);
    } else {
        return [];
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

    constructor(private extensionUri: vscode.Uri) { }

    ask = () => {
        this.view?.show();
        this.view?.webview.postMessage({ command: 'focus', value: '/ask ' });
    };
    modify = () => {
        this.view?.show();
        this.view?.webview.postMessage({ command: 'focus', value: '' });
    };

    handleMessage = async (data: any) => {
        if (data.command === 'send') {
            this.view?.webview.postMessage({ command: 'clear' });
            if (data.value.startsWith('/ask ')) {
                const message = data.value.slice(5);
                this.view?.webview.postMessage({ command: 'message', role: "user", value: message });
                this.view?.webview.postMessage({ command: 'message', role: "agent", value: "" });
                let update = '';
                for await (let token of ask(message)) {
                    update = update + token;
                    this.view?.webview.postMessage({ command: 'message-update', role: "agent", value: update });
                }
            } else {
                this.view?.webview.postMessage({ command: 'message', role: "user", value: data.value });
                const diff = await modify(data.value);
                this.view?.webview.postMessage({ command: 'message', role: "agent", diff: diff });
            }
        } else if (data.command === "approve") {
            this.view?.webview.postMessage({ command: 'clear' });
            let activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                let [selectedRange, _] = getSelectedText(activeEditor);
                let replacement = data.diff
                    .filter((change: Diff.Change) => !change.removed)
                    .map((change: Diff.Change) => change.value)
                    .join('');
                activeEditor.edit(editBuilder => {
                    editBuilder.replace(selectedRange, replacement);
                });
                vscode.window.showTextDocument(activeEditor.document, activeEditor.viewColumn);
            }
        }
    };

    resolveWebviewView(
        view: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ) {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        view.webview.html = this.getHtmlForWebview(view.webview);
        view.webview.onDidReceiveMessage(this.handleMessage);
    }

    getHtmlForWebview(webview: vscode.Webview): string {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'main.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

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
                        <textarea placeholder="Ask a question!" class="chat-message"></textarea>
                        <div class="chat-send">
                            <i class="codicon codicon-send"></i>
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
    const chatViewProvider = new ChatViewProvider(context.extensionUri);

    context.subscriptions.push(vscode.commands.registerCommand('ask-vsc.ask', chatViewProvider.ask));
    context.subscriptions.push(vscode.commands.registerCommand('ask-vsc.modify', chatViewProvider.modify));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('ask-vsc.chat-view', chatViewProvider));
}
export function deactivate() {}
