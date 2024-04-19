import * as vscode from 'vscode';
import { MODELS, Model } from './api/models';

export class Store {
    constructor(private context: vscode.ExtensionContext) { }

    getState() {
        let rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.path || "$";  // match to the empty string if no root path
        let rootPathExp = new RegExp("^" + rootPath.replace(/\\/g, '\\\\') + '/?');
        return {
            model: this.getModel(),
            files: this.getFiles().map(file => file.path.replace(rootPathExp, ''))
        };
    }

    getModel(): Model {
        let modelID = this.context.workspaceState.get<string>('modelID');
        return MODELS.find(model => model.id === modelID) || MODELS[0];
    }
    async setModel(modelName: string) {
        let model = MODELS.find(model => model.name === modelName) || MODELS[0];
        await this.context.workspaceState.update('modelID', model.id);
    }

    getFiles(): vscode.Uri[] {
        return this.context.workspaceState.get<string[]>('files', []).map(path => vscode.Uri.parse(path));
    }
    async setFiles(files: vscode.Uri[]) {
        await this.context.workspaceState.update('files', files.map(file => file.toString()));
    }
    async addFile(file: vscode.Uri) {
        let files = this.getFiles();
        if (!files.find(f => f.toString() === file.toString())) {
            await this.setFiles([...files, file]);
        }
    }
    async removeFile(file: vscode.Uri) {
        await this.setFiles(this.getFiles().filter(f => f.toString() !== file.toString()));
    }
}
