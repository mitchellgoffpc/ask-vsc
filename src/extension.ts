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

function createMessage(messages: Message[]): string {
    const filteredMessages = messages.map(formatMessage).filter(message => message !== null);
    return filteredMessages.join("\n\n");
}


// API functions

async function ask () {
    const activeEditor = vscode.window.activeTextEditor;
    const question = await vscode.window.showInputBox({ prompt: 'Enter your question' });
    if (question) {
        const message = createMessage([
            { type: "prompt", value: CODE_PROMPT },
            { type: "code",   value: activeEditor?.document.getText() || null },
            { type: "prompt", value: "Now, please answer the following question:" },
            { type: "code",   value: activeEditor?.document.getText(activeEditor.selection) || null },
            { type: "prompt", value: question }
        ]);
        fs.writeFileSync('/tmp/.message', message);
        subprocess.exec('cat /tmp/.message | ask', async (error, stdout, stderr) => {
            if (stdout.length > 60) {
                const uri = vscode.Uri.parse('answer:Answer?' + encodeURIComponent(stdout));
                const doc = await vscode.workspace.openTextDocument(uri);
                vscode.window.showTextDocument(doc, {
                    preview: false,
                    preserveFocus: true,
                    viewColumn: vscode.ViewColumn.Beside
                });
            } else {
                vscode.window.showInformationMessage(stdout);
            }
        });
    }
}

async function modify () {
    const activeEditor = vscode.window.activeTextEditor;
    const question = await vscode.window.showInputBox({ prompt: 'Enter your question' });
    if (question && activeEditor) {
        const selection = activeEditor.selection;
        const selectedText = activeEditor.document.getText(selection);
        const commonMessages: Message[] = [
            { type: "prompt", value: SYSTEM_PROMPT },
            { type: "prompt", value: CODE_PROMPT },
            { type: "code",   value: activeEditor?.document.getText() || null }
        ];
        const actionMessages: Message[] = selectedText ? [
            { type: "prompt", value: "Your task is to modify the following code (and ONLY the following code) as described below:" },
            { type: "code",   value: selectedText },
            { type: "prompt", value: question + " " + POST_PROMPT }
        ] : [
            { type: "prompt", value: "Your task is as follows:" },
            { type: "prompt", value: question + " " + INSERT_PROMPT + " " + POST_PROMPT }
        ];

        const message = createMessage([...commonMessages, ...actionMessages]);
        fs.writeFileSync('/tmp/.message', message);
        subprocess.exec('cat /tmp/.message | ask', async (error, stdout, stderr) => {
            const replacement = stdout;
            fs.writeFileSync('/tmp/.region', selectedText || "");
            fs.writeFileSync('/tmp/.replacement', stdout);
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
                    if (activeEditor.selection.isEmpty) {
                        editBuilder.insert(activeEditor.selection.active, replacement);
                    } else {
                        editBuilder.replace(activeEditor.selection, replacement);
                    }
                });
            }

            const tabs = vscode.window.tabGroups.all.map(tg => tg.tabs).flat();
            for (let tab of tabs) {
                if (tab.input instanceof vscode.TabInputText && tab.input.uri.path === "Diff") {
                    await vscode.window.tabGroups.close(tab);
                }
            }
        });
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
