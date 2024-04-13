import * as vscode from 'vscode';
import { Model } from './api/models';
import { query } from './api/query';
import { SYSTEM_PROMPT, EDITING_RULES_PROMPT, CODE_PROMPT } from './prompts';
import { Document, isNotebookDocument, isValidTab, openDocumentFromTab, getSelectedText, resolveFileURI } from './helpers';

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

function getCellText(cell: vscode.NotebookCell, editor: vscode.TextEditor | undefined): string {
    const cellText = cell.document.getText();
    if (cell.kind === vscode.NotebookCellKind.Markup) {
        return `"""\n${cellText}\n"""`;  // TODO: Make this work for non-python code
    } else {
        return cellText;
    }
}

function getDocumentText(document: Document, editor: vscode.TextEditor | undefined): string[] {
    if (isNotebookDocument(document)) {
        return document.getCells().map(cell => getCellText(cell, editor));
    } else {
        return [document.getText()];
    }
}

async function getCodeMessages(question: string, activeDocument: Document | undefined, editor: vscode.TextEditor | undefined): Promise<Message[]> {
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
            for (let [i, value] of getDocumentText(document, editor).entries()) {
                let name = isNotebookDocument(document) ? `${path}, cell ${i + 1}` : path;
                messages.push({ type: "code", name, value });
            }
        }
    }
    return messages;
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

export async function* ask(question: string, model: Model, controller: AbortController): AsyncIterable<string> {
    const activeEditor = vscode.window.activeTextEditor;
    const activeDocument = vscode.window.activeNotebookEditor?.notebook || activeEditor?.document;
    if (question) {
        const selectedText = getSelectedText(activeEditor);

        const commonMessages: Message[] = [
            { type: "prompt", value: SYSTEM_PROMPT },
            { type: "prompt", value: EDITING_RULES_PROMPT },
            { type: "prompt", value: CODE_PROMPT },
            ...await getCodeMessages(question, activeDocument, activeEditor),
        ];
        const actionMessages: Message[] = selectedText ? [
            { type: "prompt", value: "The following is the code I have currently selected." },
            { type: "code",   value: selectedText }
        ] : [];
        const questionMessages: Message[] = [{ type: "prompt", value: removeTags(question) }];
        const prompt = createPrompt([...commonMessages, ...actionMessages, ...questionMessages]);

        for await (let update of accumulate(query(prompt, model, controller))) {
            yield update;
        }
    }
}
