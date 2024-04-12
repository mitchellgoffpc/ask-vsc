import * as vscode from 'vscode';
import * as Diff from 'diff';
import { Model } from './api/models';
import { query } from './api/query';
import { getSelectedText, resolveFileURI } from './helpers';
import { SYSTEM_PROMPT, EDITING_RULES_PROMPT, CODE_PROMPT } from './prompts';

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

function isNotebookDocument(document: Document): document is vscode.NotebookDocument {
    return typeof document !== 'undefined' && 'cellCount' in document;
}
function isTextDocument(document: Document): document is vscode.TextDocument {
    return typeof document !== 'undefined' && 'lineCount' in document;
}
function isValidTab(tabInput: unknown): tabInput is vscode.TabInputText | vscode.TabInputNotebook {
    return typeof tabInput !== 'undefined' && (tabInput instanceof vscode.TabInputText || tabInput instanceof vscode.TabInputNotebook);
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
            ...await getCodeMessages(question, activeDocument, activeEditor, true),
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
