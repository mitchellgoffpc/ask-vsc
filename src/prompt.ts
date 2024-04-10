import * as vscode from 'vscode';
import * as Diff from 'diff';
import { Model } from './api/models';
import { query } from './api/query';
import { getSelectedText, resolveFileURI } from './helpers';

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

export async function* modify(question: string, model: Model, controller: AbortController): AsyncIterable<Diff.Change[]> {
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
