const vscode = acquireVsCodeApi();

const CHAT_PLACEHOLDER = "Ask ChatGPT a question and the response will appear here.";
const ROLE_NAMES = {
    user: "User",
    agent: "Agent",
};

function autogrow(element) {
    element.style.height = "5px";
    element.style.height = (element.scrollHeight) + "px";
}

function updateState(getState) {
    vscode.setState(getState(vscode.getState()));
}


// Rendering

function createElement(tag, attributes, children) {
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

function renderMarkdownLine(tag, line) {
    const span = document.createElement(tag);
    let formattedLine = line
        .replace(/(\*\*\*([^\*]+)\*\*\*)/g, '<b><i>$2</i></b>')
        .replace(/(\*\*([^\*]+)\*\*)/g, '<b>$2</b>')
        .replace(/(\*([^\*]+)\*)/g, '<i>$2</i>');
    span.innerHTML = formattedLine;
    return span;
}

function renderMarkdownUnorderedList(lines) {
    let list = document.createElement('ul');
    let lineCount = 0;
    for (let line of lines) {
        if (!line.startsWith('- ')) { break; }
        list.appendChild(renderMarkdownLine('li', line.substring(2)));
        lineCount++;
    }
    return [list, lineCount];
}

function renderMarkdownOrderedList(lines) {
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
    list.setAttribute('start', startIndex || 1);
    return [list, lineCount];
}

function renderMarkdownCode(lines) {
    let codeBlock = document.createElement('pre');
    let lineCount = 0;
    for (let line of lines) {
        if (line.match(/^\s*```/)) { break; }
        let lineElement = document.createElement('div');
        lineElement.textContent = line;
        codeBlock.appendChild(lineElement);
        lineCount++;
    }
    return [codeBlock, lineCount];
}

function renderMarkdown(input) {
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

function getDiffLineClass(line) {
    if (line.match(/^\+(?!\+)/)) {
        return 'add';
    } else if (line.match(/^\-(?!\-)/)) {
        return 'remove';
    } else {
        return null;
    }
}

function renderDiff(message) {
    return [
        createElement('div', {className: 'chat-code'}, [
            createElement('code', {lang: 'diff'}, message.diff.split('\n').map(line =>
                createElement('span', {className: getDiffLineClass(line)}, line)))
        ]),
        createElement('button', {className: 'chat-approve', onClick: () => {
            vscode.postMessage({ command: 'approve', value: message.replacement });
        }}, "Approve")
    ];
}

function renderMessage(message) {
    return createElement('div', {className: 'chat-message'}, [
        createElement('div', {className: 'chat-header'}, ROLE_NAMES[message.role]),
        createElement('div', {className: 'chat-body'},
            message.diff ? renderDiff(message) : [renderMarkdown(message.value)])]);
}

function updateChatOutput(chatOutput) {
    let chatHistory = vscode.getState()?.chatHistory || [];
    chatOutput.replaceChildren(
        chatHistory.length
            ? createElement('div', {className: 'chat-messages'}, chatHistory.map(renderMessage))
            : createElement('span', {className: 'chat-placeholder'}, CHAT_PLACEHOLDER));
}

function updateChatInput(chatInput) {
    chatInput.value = vscode.getState()?.text || "";
    chatInput.focus();
    autogrow(chatInput);
}


// Event Handlers

document.addEventListener('DOMContentLoaded', function() {
    let chatOutput = document.querySelector('.chat-output');
    let chatInput = document.querySelector('.chat-input textarea');
    let chatSubmit = document.querySelector('.chat-input .chat-send');

    updateChatOutput(chatOutput);
    updateChatInput(chatInput);

    function submit() {
        if (chatInput.value) {
            vscode.postMessage({ command: 'send', value: chatInput.value });
            updateState(state => ({...state, text: ""}));
            updateChatInput(chatInput);
        }
    }

    chatInput.addEventListener('input', () => {
        updateState(state => ({...state, text: chatInput.value}));
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
            updateState(state => ({...state, chatHistory: []}));
            updateChatOutput(chatOutput);
        } else if (message.command === 'message') {
            updateState(state => ({...state, chatHistory: [...state.chatHistory, message]}));
            updateChatOutput(chatOutput);
        } else if (message.command === 'focus') {
            updateState(state => ({...state, text: message.value}));
            updateChatInput(chatInput);
        }
    });
});
