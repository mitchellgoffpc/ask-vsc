const vscode = acquireVsCodeApi();

const CHAT_PLACEHOLDER = "Ask ChatGPT a question and the response will appear here.";
const ROLE_NAMES: any = {
    user: "User",
    agent: "Agent",
};

function autogrow(element: HTMLElement): void {
    element.style.height = "5px";
    element.style.height = (element.scrollHeight) + "px";
}

function getState(): any {
    return vscode.getState() || {};
}
function updateState(getState: Function): void {
    vscode.setState(getState(vscode.getState()));
}


// Rendering

function createElement(tag: string, attributes: any, children: HTMLElement[] | string): HTMLElement {
    const element = document.createElement(tag);

    for (let key in attributes) {
        if (key === 'className') {
            element.classList.add(attributes[key]);
        } else if (key.startsWith('on') && attributes[key] instanceof Function) {
            element.addEventListener(key.substring(2).toLowerCase(), attributes[key]);
        } else {
            element.setAttribute(key, attributes[key]);
        }
    }

    if (children instanceof Array) {
        element.replaceChildren(...children);
    } else {
        element.textContent = children;
    }
    return element;
}

function renderMarkdownLine(tag: string, line: string): HTMLElement {
    const span = document.createElement(tag);
    let formattedLine = line
        .replace(/(\*\*\*([^\*]+)\*\*\*)/g, '<b><i>$2</i></b>')
        .replace(/(\*\*([^\*]+)\*\*)/g, '<b>$2</b>')
        .replace(/(\*([^\*]+)\*)/g, '<i>$2</i>')
        .replace(/(\`([^\`]+)\`)/g, '<code>$2</code>');
    span.innerHTML = formattedLine;
    return span;
}

function renderMarkdownUnorderedList(lines: string[]): [HTMLElement, number] {
    let list = document.createElement('ul');
    let lineCount = 0;
    for (let line of lines) {
        if (!line.startsWith('- ')) { break; }
        list.appendChild(renderMarkdownLine('li', line.substring(2)));
        lineCount++;
    }
    return [list, lineCount];
}

function renderMarkdownOrderedList(lines: string[]): [HTMLElement, number] {
    let list = document.createElement('ol');
    let lineCount = 0;
    let startIndex = null;
    for (let line of lines) {
        let match = line.match(/^(\d+)\. (.*)/);
        if (!match) { break; }
        if (!startIndex) { startIndex = match[1]; }
        list.appendChild(renderMarkdownLine('li', match[2]));
        lineCount++;
    }
    list.setAttribute('start', startIndex || "1");
    return [list, lineCount];
}

function renderMarkdownCode(lines: string[]): [HTMLElement, number] {
    let codeBlock = document.createElement('pre');
    let lineCount = 0;
    for (let line of lines) {
        if (line.match(/^\s*```/)) { break; }
        codeBlock.appendChild(createElement('div', {}, line));
        lineCount++;
    }
    return [codeBlock, lineCount];
}

function renderMarkdown(input: string): HTMLElement {
    let div = document.createElement('div');
    let lines = input.split('\n');
    let i = 0;

    while (i < lines.length) {
        if (lines[i].match(/^\s*```/)) {
            const [codeBlock, codeLineCount] = renderMarkdownCode(lines.slice(i + 1));
            div.appendChild(codeBlock);
            i += codeLineCount + 2;
        } else if (lines[i].startsWith('- ')) {
            const [list, listLineCount] = renderMarkdownUnorderedList(lines.slice(i));
            div.appendChild(list);
            i += listLineCount;
        } else if (lines[i].match(/^\d+\. /)) {
            const [list, listLineCount] = renderMarkdownOrderedList(lines.slice(i));
            div.appendChild(list);
            i += listLineCount;
        } else {
            div.appendChild(renderMarkdownLine('p', lines[i]));
            i++;
        }
    }

    return div;
}

function getDiffLineClass(line: string): string | null {
    if (line.match(/^\+(?!\+)/)) {
        return 'add';
    } else if (line.match(/^\-(?!\-)/)) {
        return 'remove';
    } else {
        return null;
    }
}

function renderDiff(message: any): HTMLElement[] {
    return [
        createElement('div', {className: 'chat-code'}, [
            createElement('code', {lang: 'diff'}, message.diff.split('\n').map((line: string) =>
                createElement('span', {className: getDiffLineClass(line)}, line)))
        ]),
        createElement('button', {className: 'chat-approve', onClick: () => {
            vscode.postMessage({ command: 'approve', value: message.replacement });
        }}, "Approve")
    ];
}

function renderMessage(message: any): HTMLElement {
    return createElement('div', {className: 'chat-message'}, [
        createElement('div', {className: 'chat-header'}, ROLE_NAMES[message.role]),
        createElement('div', {className: 'chat-body'},
            message.diff ? renderDiff(message) : [renderMarkdown(message.value)])]);
}

function updateChatOutput(chatOutput: HTMLElement): void{
    let chatHistory = getState().chatHistory || [];
    chatOutput.replaceChildren(
        chatHistory.length
            ? createElement('div', {className: 'chat-messages'}, chatHistory.map(renderMessage))
            : createElement('span', {className: 'chat-placeholder'}, CHAT_PLACEHOLDER));
}

function updateChatInput(chatInput: HTMLTextAreaElement): void {
    chatInput.value = getState().text || "";
    chatInput.focus();
    autogrow(chatInput);
}


// Event Handlers

document.addEventListener('DOMContentLoaded', function() {
    let chatOutput = document.querySelector('.chat-output') as HTMLElement;
    let chatInput = document.querySelector('.chat-input textarea') as HTMLTextAreaElement;
    let chatSubmit = document.querySelector('.chat-input .chat-send') as HTMLElement;
    if (!chatOutput || !chatInput || !chatSubmit) { return; }

    updateChatOutput(chatOutput);
    updateChatInput(chatInput);

    function submit() {
        if (chatInput && chatInput.value) {
            vscode.postMessage({ command: 'send', value: chatInput.value });
            updateState((state: any) => ({...state, text: ""}));
            updateChatInput(chatInput);
        }
    }

    chatInput.addEventListener('input', () => {
        updateState((state: any) => ({...state, text: chatInput.value}));
        autogrow(chatInput);
    });

    chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    });

    chatSubmit.addEventListener('click', submit);

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'clear') {
            updateState((state: any) => ({...state, chatHistory: []}));
            updateChatOutput(chatOutput);
        } else if (message.command === 'message') {
            updateState((state: any) => ({...state, chatHistory: [...state.chatHistory, message]}));
            updateChatOutput(chatOutput);
        } else if (message.command === 'focus') {
            updateState((state: any) => ({...state, text: message.value}));
            updateChatInput(chatInput);
        }
    });
});
