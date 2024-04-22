export const vscode = acquireVsCodeApi();

type FilePath = {
    path: string;
    isDir: boolean;
};
type EventListener = {
    type: string;
    listener: (event: any) => void;
};

// API functions

export function requestState() {
    vscode.postMessage({action: 'getstate'});
}
export function sendQuery(query: string) {
    vscode.postMessage({ action: 'submit', value: query });
}
export function sendCommand(command: string, args: string[]) {
    vscode.postMessage({action: 'command', command, args});
}
export function approveDiff(diff: string) {
    vscode.postMessage({action: 'approve', diff});
}
export function setModel(modelID: string) {
    vscode.postMessage({action: 'setmodel', value: modelID});
}
export function removeFile(file: string) {
    vscode.postMessage({action: 'removefile', value: file});
}
export function unfocus() {
    vscode.postMessage({ action: 'unfocus' });
}

// TODO: Make these actually work
export async function getTabs(): Promise<string[]> {
    return new Promise<string[]>(resolve => {
        function handleGetTabs(event: any) {
            removeEventListener('gettabs', handleGetTabs);
            resolve(event.value);
        }
        addEventListener('gettabs', handleGetTabs);
        vscode.postMessage({action: 'gettabs'});
    });
}
export async function getFiles(value: string): Promise<FilePath[]> {
    return new Promise<FilePath[]>(resolve => {
        function handleGetFiles(event: any) {
            removeEventListener('getfiles', handleGetFiles);
            resolve(event.value);
        }
        addEventListener('getfiles', handleGetFiles);
        vscode.postMessage({action: 'getfiles', value});
    });
}

// Event listeners

let eventListeners: EventListener[] = [];
export function addEventListener(type: string, listener: (event: any) => void) {
    eventListeners.push({ type, listener });
}
export function removeEventListener(type: string, listener: (event: any) => void) {
    eventListeners = eventListeners.filter(({type: t, listener: l}) => type !== t || listener !== l);
}

window.addEventListener('message', event => {
    for (let {type, listener} of eventListeners) {
        if (type === event.data.action) {
            listener(event.data);
        }
    }
});
