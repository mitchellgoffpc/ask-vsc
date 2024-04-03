const vscode = acquireVsCodeApi();

const TAGS = ["file", "null"];
const CHAT_PLACEHOLDER = "Ask a question and the response will appear here.";
const ROLE_NAMES: any = {
    user: "User",
    agent: "Agent",
};

type Message = {
    role: string;
    value: string;
};

type State = {
    chatMessages: Message[];
    chatHistory: string[];
    chatHistoryOffset: number;
    text: string;
};

function getState(): State {
    return {
        chatMessages: [],
        chatHistory: [],
        chatHistoryOffset: -1,
        text: "",
        ...(vscode.getState() || {}),
    };
}

function updateState(getNextState: (state: State) => State): void {
    vscode.setState(getNextState(getState()));
}


// Helper functions

function autogrow(element: HTMLElement): void {
    element.style.height = "5px";
    element.style.height = `${element.scrollHeight}px`;
}

function getCursorLine(textarea: HTMLTextAreaElement, fromEnd: boolean = false): number {
    let bbox = textarea.getBoundingClientRect();
    let style = {position: 'absolute', top: 0, left: 0, visibility: 'hidden', width: `${bbox.width}px`, height: '5px'};
    let mirror = createElement('textarea', {style}, '');
    document.body.appendChild(mirror);

    let lineHeight = mirror.scrollHeight;
    mirror.innerHTML = textarea.value.substring(0, textarea.selectionStart + 1);
    let cursorHeight = mirror.scrollHeight;
    mirror.innerHTML = textarea.value;
    let fullHeight = mirror.scrollHeight;
    let cursorLine = Math.round(cursorHeight / lineHeight) - 1;
    let totalLines = Math.round(fullHeight / lineHeight);

    mirror.remove();
    return fromEnd ? cursorLine - totalLines : cursorLine;
}

function createElement(tag: string, attributes: any, children: HTMLElement[] | string): HTMLElement {
    const element = document.createElement(tag);

    for (let key in attributes) {
        if (key === 'style') {
            Object.assign(element.style, attributes[key]);
        } else if (key === 'className') {
            for (let className of (attributes[key] || "").split(' ')) {
                if (className) {
                    element.classList.add(className);
                }
            }
        } else if (key.startsWith('on') && attributes[key] instanceof Function) {
            element.addEventListener(key[2].toLowerCase() + key.substring(3), attributes[key]);
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


// Rendering

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

function getDiffChangeClass(change: Diff.Change): string | null {
    return change.added   ? 'add' :
           change.removed ? 'remove' :
                            null;
}

function formatDiffLine(line: string, change: Diff.Change): string {
    return change.added   ? `+${line}` :
           change.removed ? `-${line}` :
                            ` ${line}`;
}

function formatDiffChange(change: Diff.Change): string {
    let lines = change.value.replace(/\n$/, '').split('\n');
    let formattedLines = lines.map(line => formatDiffLine(line, change));
    return formattedLines.join('\n') + '\n';
}

function renderDiff(message: any): HTMLElement[] {
    return [
        createElement('div', {className: 'code'}, [
            createElement('pre', {lang: 'diff'}, message.diff.map((change: Diff.Change) =>
                createElement('span', {className: getDiffChangeClass(change)}, formatDiffChange(change))))
        ]),
        message.unfinished
          ? createElement('div', {}, '')
          : createElement('button', {className: 'approve', onClick: () => {
                vscode.postMessage({ command: 'approve', diff: message.diff });
            }}, "Approve")
    ];
}

function renderMessage(message: any): HTMLElement {
    return createElement('div', {className: 'message'}, [
        createElement('div', {className: 'header'}, ROLE_NAMES[message.role]),
        createElement('div', {className: 'body'},
            message.diff ? renderDiff(message) : [renderMarkdown(message.value)])]);
}

function updateChatOutput(chatOutput: HTMLElement): void {
    let chatMessages = getState().chatMessages || [];
    chatOutput.replaceChildren(
        chatMessages.length
          ? createElement('div', {className: 'messages'}, chatMessages.map(renderMessage))
          : createElement('span', {className: 'placeholder'}, CHAT_PLACEHOLDER));
}

function updateChatInput(chatInput: HTMLTextAreaElement): void {
    let {chatHistory, chatHistoryOffset, text} = getState();
    chatInput.value = chatHistoryOffset >= 0 ? chatHistory[chatHistoryOffset] : text;
    chatInput.focus();
    autogrow(chatInput);
}

function showAutocomplete(textarea: HTMLTextAreaElement, autocomplete: HTMLElement): void {
    let tagStart = textarea.value.lastIndexOf('@', textarea.selectionStart);
    let tagValue = textarea.value.substring(tagStart + 1, textarea.selectionStart);
    let validOptions = TAGS.filter(option => option.startsWith(tagValue));
    if (validOptions.length) {
        autocomplete.style.display = "block";
        autocomplete.replaceChildren(...validOptions.map((option, i) =>
            createElement("div", {
                className: i === 0 ? "option selected" : "option",
                onClick: () => fillAutocomplete(textarea, autocomplete, option)
            }, `@${option}`)));
    } else {
        hideAutocomplete(autocomplete);
    }
}

function hideAutocomplete(autocomplete: HTMLElement): void {
    autocomplete.style.display = "none";
}

function fillAutocomplete(textarea: HTMLTextAreaElement, autocomplete: HTMLElement, value: string): void {
    let tagStart = textarea.value.lastIndexOf('@', textarea.selectionStart);
    textarea.value = textarea.value.substring(0, tagStart) + value + textarea.value.substring(textarea.selectionEnd);
    hideAutocomplete(autocomplete);
}


// Event Handlers

function handleAutocompleteKeypress(event: KeyboardEvent, textarea: HTMLTextAreaElement, autocomplete: HTMLElement): void {
    let options = Array.from(autocomplete.querySelectorAll('.option'));
    let index = options.findIndex(option => option.classList.contains('selected'));

    if (event.key === 'Escape') {
        event.preventDefault();
        hideAutocomplete(autocomplete);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        fillAutocomplete(textarea, autocomplete, options[index].textContent || "");
    } else  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        let nextIndex = event.key === 'ArrowDown'
            ? (index + 1) % options.length
            : (index + options.length - 1) % options.length;
        options.forEach((option, i) => option.classList.toggle('selected', i === nextIndex));
    }
}

function handleAutocompleteInput(textarea: HTMLTextAreaElement, autocomplete: HTMLElement): void {
    let tagStart = textarea.value.lastIndexOf('@', textarea.selectionStart);
    let tagValue = textarea.value.substring(tagStart + 1, textarea.selectionStart);
    if (tagValue.includes(' ')) {
        hideAutocomplete(autocomplete);
    } else {
        showAutocomplete(textarea, autocomplete);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    let chatOutput = document.querySelector('.chat-output') as HTMLElement;
    let chatInput = document.querySelector('.chat-input textarea') as HTMLTextAreaElement;
    let chatSubmit = document.querySelector('.chat-input .send') as HTMLElement;
    let chatAutocomplete = document.querySelector('.chat-input .autocomplete') as HTMLElement;
    let chatModelSelect = document.querySelector('.chat-input .model-select') as HTMLElement;
    let chatModelName = document.querySelector('.chat-input .model-name') as HTMLElement;
    if (!chatOutput || !chatInput || !chatSubmit || !chatModelSelect) { return; }

    updateChatOutput(chatOutput);
    updateChatInput(chatInput);

    function submit(isModification: boolean) {
        if (chatInput && chatInput.value) {
            vscode.postMessage({ command: 'send', value: chatInput.value, isModification });
            updateState(state => ({...state, text: "", chatHistoryOffset: -1, chatHistory: [chatInput.value, ...state.chatHistory]}));
            updateChatInput(chatInput);
        }
    }

    chatInput.addEventListener('input', () => {
        handleAutocompleteInput(chatInput, chatAutocomplete);
        updateState(state =>
            state.chatHistoryOffset >= 0
                ? {...state, chatHistory: [...state.chatHistory.slice(0, state.chatHistoryOffset), chatInput.value, ...state.chatHistory.slice(state.chatHistoryOffset + 1)]}
                : {...state, text: chatInput.value});
        autogrow(chatInput);
    });

    chatInput.addEventListener('keydown', e => {
        if (chatAutocomplete.style.display === "block") {
            handleAutocompleteKeypress(e, chatInput, chatAutocomplete);
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(e.ctrlKey || e.metaKey);
        } else if (e.key === 'PageUp' || (e.key === 'ArrowUp' && getCursorLine(chatInput) === 0)) {
            e.preventDefault();
            updateState(state => ({...state, chatHistoryOffset: Math.min(state.chatHistoryOffset + 1, state.chatHistory.length - 1)}));
            updateChatInput(chatInput);
        } else if (e.key === 'PageDown' || (e.key === 'ArrowDown' && getCursorLine(chatInput, true) === -1)) {
            e.preventDefault();
            updateState(state => ({...state, chatHistoryOffset: Math.max(state.chatHistoryOffset - 1, -1)}));
            updateChatInput(chatInput);
        } else if (e.key === 'g' && e.ctrlKey) {
            vscode.postMessage({ command: 'unfocus' });
        } else if (e.key === '@') {
            showAutocomplete(chatInput, chatAutocomplete);
        }
    });

    chatSubmit.addEventListener('click', e => submit(e.ctrlKey || e.metaKey));

    chatModelSelect.addEventListener('click', e => {
        chatModelSelect.classList.toggle('open');
        if (e.target instanceof HTMLElement && e.target.hasAttribute('data-value')) {
            let model = e.target.getAttribute('data-value');
            vscode.postMessage({ command: 'model', value: model });
            chatModelName.textContent = model;
        }
    });

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'clear') {
            updateState(state => ({...state, chatMessages: []}));
            updateChatOutput(chatOutput);
        } else if (message.command === 'message') {
            updateState(state => ({...state, chatMessages: [...state.chatMessages, message]}));
            updateChatOutput(chatOutput);
        } else if (message.command === 'message-update') {
            updateState(state => ({...state, chatMessages: [...state.chatMessages.slice(0, -1), message]}));
            let lastMessage = chatOutput.querySelector('.messages > .message:last-child');
            let body = lastMessage?.querySelector('.body');
            let newBody = message.diff
              ? renderDiff({...message, unfinished: true})
              : [renderMarkdown(message.value)];
            body?.replaceChildren(...newBody);
        } else if (message.command === 'message-done') {
            updateChatOutput(chatOutput);
        } else if (message.command === 'focus') {
            updateState(state => ({...state, text: message.value}));
            updateChatInput(chatInput);
        } else if (message.command === 'state') {
            // updateState(state => ({...state, chatMessages: message.value.chatMessages}));
            // updateChatOutput(chatOutput);
            chatModelName.textContent = message.value.model.name;
        }
    });

    vscode.postMessage({ command: 'getstate' });
});
