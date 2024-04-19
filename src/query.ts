import * as vscode from 'vscode';
import { Model } from './api/models';
import { query } from './api/query';
import { Document, isNotebookDocument, isValidTab, openDocumentFromTab, getSelectedText, resolveFileURI, getLocalPath } from './helpers';
import * as Prompts from './prompts';

type Message = {
    type: "prompt" | "code";
    text: string | null;
    name?: string;
    kind?: vscode.NotebookCellKind;
};


// Helper functions

async function* accumulate(iterable: AsyncIterable<string>): AsyncIterable<string> {
    let result = "";
    for await (let value of iterable) {
        result += value;
        yield result;
    }
}

function getDocumentText(document: Document): { text: string; kind?: vscode.NotebookCellKind }[] {
    if (isNotebookDocument(document)) {
        return document.getCells().map(cell => ({ text: cell.document.getText(), kind: cell.kind }));
    } else {
        return [{ text: document.getText() }];
    }
}

async function getCodeMessages(activeDocument: Document | undefined, files: vscode.Uri[]): Promise<Message[]> {
    let documents: Map<string, Document | undefined> = new Map();
    if (activeDocument) {
        documents.set(activeDocument.uri.path, activeDocument);
    }
    for (let uri of files) {
        documents.set(uri.path, await vscode.workspace.openTextDocument(uri));
    }

    let messages: Message[] = [];
    for (let [path, document] of documents) {
        if (document) {
            for (let [i, {text, kind}] of getDocumentText(document).entries()) {
                let name = i === 0 ? getLocalPath(path) : undefined;
                messages.push({ type: "code", name, kind, text });
            }
        }
    }
    return messages;
}

function formatMessage(message: Message): string | null {
    if (message.text === null) {
        return null;
    } else if (message.type === "prompt") {
        return message.text;
    } else if (message.type === "code") {
        let name = message.name ? `${message.name}\n` : "";
        let cellType = message.kind === vscode.NotebookCellKind.Code   ? "code" :
                       message.kind === vscode.NotebookCellKind.Markup ? "markdown" :
                                                                         "";
        return `${name}\`\`\`${cellType}\n${message.text}\n\`\`\``;
    } else {
        return null;
    }
}

function createPrompt(messages: Message[]): string {
    const filteredMessages = messages.map(formatMessage).filter(message => message !== null);
    return filteredMessages.join("\n\n");
}


// API functions

export async function* ask(question: string, files: vscode.Uri[], model: Model, controller: AbortController): AsyncIterable<string> {
    const activeEditor = vscode.window.activeTextEditor;
    const activeDocument = vscode.window.activeNotebookEditor?.notebook || activeEditor?.document;
    if (question) {
        const systemPrompt = createPrompt([
            { type: "prompt", text: Prompts.SYSTEM },
            { type: "prompt", text: Prompts.EDITING_RULES },
        ]);
        const userPrompt = createPrompt([
            { type: "prompt", text: Prompts.NO_REPO },
            { type: "prompt", text: Prompts.FILE_CONTENT },
            ...await getCodeMessages(activeDocument, files),
            { type: "prompt", text: question },
        ]);

        // console.log(userPrompt);
        // const selectedText = getSelectedText(activeEditor);
        // const actionMessages: Message[] = selectedText ? [
        //     { type: "prompt", text: "The following is the code I have currently selected." },
        //     { type: "code",   text: selectedText }

        const prompt = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ];

        for await (let update of accumulate(query(prompt, model, controller))) {
            yield update;
        }
    }
}
