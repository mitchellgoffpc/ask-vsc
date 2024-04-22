import * as vscode from 'vscode';
import { MODELS, Model } from './api/models';
import { Message } from './api/query';

export class Store {
    constructor(private context: vscode.ExtensionContext) { }

    getState() {
        let rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.path || "$";  // match to the empty string if no root path
        let rootPathExp = new RegExp("^" + rootPath.replace(/\\/g, '\\\\') + '/?');
        return {
            model: this.getModel(),
            files: this.getFiles().map(file => file.path.replace(rootPathExp, '')),
            history: this.getHistory(),
            messages: this.getMessages(),
        };
    }

    getModel(): Model {
        let modelID = this.context.workspaceState.get<string>('modelID');
        return MODELS.find(model => model.id === modelID) || MODELS[0];
    }
    async setModel(modelID: string) {
        let model = MODELS.find(model => model.id === modelID) || MODELS[0];
        await this.context.workspaceState.update('modelID', model.id);
    }

    getFiles(): vscode.Uri[] {
        return this.context.workspaceState.get<string[]>('files', []).map(path => vscode.Uri.parse(path));
    }
    async setFiles(files: vscode.Uri[]): Promise<void> {
        await this.context.workspaceState.update('files', files.map(file => file.toString()));
    }
    async addFile(file: vscode.Uri): Promise<void> {
        let files = this.getFiles();
        if (!files.find(f => f.toString() === file.toString())) {
            await this.setFiles([...files, file]);
        }
    }
    async removeFile(file: vscode.Uri): Promise<void> {
        await this.setFiles(this.getFiles().filter(f => f.toString() !== file.toString()));
    }

    getHistory(): string[] {
        return this.context.workspaceState.get<string[]>('history', []);
    }
    async pushHistory(text: string): Promise<void> {
        let history = this.getHistory();
        await this.context.workspaceState.update('history', [text, ...history]);
    }

    getMessages(): Message[] {
        return this.context.workspaceState.get<Message[]>('messages', []);
    }
    async setMessages(messages: Message[]): Promise<void> {
        await this.context.workspaceState.update('messages', messages);
    }
}
