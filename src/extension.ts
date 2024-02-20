import * as vscode from 'vscode';
import * as fs from 'fs';
import * as subprocess from 'child_process';

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
    if (message.value === null) {
       return null;
    } else if (message.type === "prompt") {
        return message.value;
    } else if (message.type === "code") {
        return `\`\`\`\n${message.value}\n\`\`\``;
    } else {
        throw Error("Unexpected message type");
    }
}

function createPrompt(messages: Message[]): string {
    const filteredMessages = messages.map(formatMessage).filter(message => message !== null);
    return filteredMessages.join("\n\n");
}

function query(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.writeFileSync('/tmp/.message', prompt);
        subprocess.exec('cat /tmp/.message | ask', (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}


// API functions

async function ask () {
    const activeEditor = vscode.window.activeTextEditor;
    const question = await vscode.window.showInputBox({ prompt: 'Enter your question' });
    if (question && activeEditor) {
        const [_, selectedText] = getSelectedText(activeEditor);
        const prompt = createPrompt([
            { type: "prompt", value: CODE_PROMPT },
            { type: "code",   value: activeEditor?.document.getText() || null },
            { type: "prompt", value: "Now, please answer the following question:" },
            { type: "code",   value: selectedText },
            { type: "prompt", value: question }
        ]);
        const response = await query(prompt);
        if (response.length > 60) {
            const uri = vscode.Uri.parse('answer:Answer?' + encodeURIComponent(response));
            const doc = await vscode.workspace.openTextDocument(uri);
            vscode.window.showTextDocument(doc, {
                preview: false,
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Beside
            });
        } else {
            vscode.window.showInformationMessage(response);
        }
    }
}

async function modify () {
    const activeEditor = vscode.window.activeTextEditor;
    const question = await vscode.window.showInputBox({ prompt: 'Enter your question' });
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
        const response = await query(prompt);
        const replacement = applyIndentationLevel(removeTrailingNewlines(removeBackticks(response)), indentationLevel);
        fs.writeFileSync('/tmp/.region', selectedText || "");
        fs.writeFileSync('/tmp/.replacement', replacement);
        subprocess.exec('git diff --no-index /tmp/.region /tmp/.replacement', async (error, stdout, stderr) => {
            const uri = vscode.Uri.parse('answer:Diff?' + encodeURIComponent(stdout));
            const doc = await vscode.workspace.openTextDocument(uri);
            vscode.languages.setTextDocumentLanguage(doc, "diff");
            vscode.window.showTextDocument(doc, {
                preview: false,
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Beside
            });
        });

        const selectedOption = await vscode.window.showInformationMessage(
            'Do you want to apply the changes?',
            'Approve', 'Reject'
        );

        if (selectedOption === 'Approve') {
            activeEditor?.edit(editBuilder => {
                editBuilder.replace(selectedRange, replacement);
            });
        }

        const tabs = vscode.window.tabGroups.all.map(tg => tg.tabs).flat();
        for (let tab of tabs) {
            if (tab.input instanceof vscode.TabInputText && tab.input.uri.path === "Diff") {
                await vscode.window.tabGroups.close(tab);
            }
        }
    }
}


// Answer mode

const answerProvider = new class implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
        return uri.query;
    }
};


// Register commands

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('ask-vsc.ask', ask));
    context.subscriptions.push(vscode.commands.registerCommand('ask-vsc.modify', modify));
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('answer', answerProvider));
}
export function deactivate() {}
