const vscode = acquireVsCodeApi();

const ROLE_NAMES = {
    user: "User",
    agent: "Agent",
};

function autogrow(element) {
    element.style.height = "5px";
    element.style.height = (element.scrollHeight) + "px";
}

function submit() {
    let chatInput = document.querySelector('.chat-input textarea');
    if (chatInput.value) {
        vscode.postMessage({
            command: 'send',
            value: chatInput.value
        });
        chatInput.value = '';
        vscode.setState({ ...vscode.getState(), text: "" });
    }
}

function renderDiff(message) {
    let chatCode = document.createElement('div');
    chatCode.classList.add('chat-code');
    let codeBlock = document.createElement('code');
    codeBlock.setAttribute('lang', 'diff');
    for (let line of message.diff.split('\n')) {
        let lineElement = document.createElement('span');
        lineElement.textContent = line;
        if (line.match(/^\+(?!\+)/)) {
            lineElement.classList.add('add');
        } else if (line.match(/^\-(?!\-)/)) {
            lineElement.classList.add('remove');
        }
        codeBlock.appendChild(lineElement);
    }
    chatCode.appendChild(codeBlock);

    approveButton = document.createElement('button');
    approveButton.textContent = "Approve";
    approveButton.classList.add('chat-approve');
    approveButton.addEventListener('click', () => {
        vscode.postMessage({
            command: 'approve',
            value: message.replacement
        });
    });

    return [chatCode, approveButton];
}

function renderMessage(message) {
    let chatMessage = document.createElement('div');
    chatMessage.classList.add('chat-message');

    let chatHeader = document.createElement('div');
    chatHeader.classList.add('chat-header');
    chatHeader.textContent = ROLE_NAMES[message.role];

    let chatBody = document.createElement('div');
    chatBody.classList.add('chat-body');

    if (message.diff) {
        for (let element of renderDiff(message)) {
            chatBody.appendChild(element);
        }
    } else {
        chatBody.textContent = message.value;
    }

    chatMessage.appendChild(chatHeader);
    chatMessage.appendChild(chatBody);
    return chatMessage;
}


// Entry Point

document.addEventListener('DOMContentLoaded', function() {
    let chatOutput = document.querySelector('.chat');
    let chatInput = document.querySelector('.chat-input textarea');
    let chatSubmit = document.querySelector('.chat-input .chat-send');
    vscode.setState({ ...vscode.getState(), chatHistory: [] });
    let chatHistory = vscode.getState()?.chatHistory || [];

    if (chatHistory.length > 0) {
        document.querySelector('.chat .chat-placeholder')?.remove();
    }
    for (let message of chatHistory) {
        chatOutput.appendChild(renderMessage(message));
    }

    chatInput.value = vscode.getState()?.text || "";
    chatInput.focus();
    autogrow(chatInput);

    chatInput.addEventListener('input', () => {
        vscode.setState({ ...vscode.getState(), text: chatInput.value });
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
        if (message.command === 'message') {
            chatOutput.appendChild(renderMessage(message));
            chatHistory.push(message);
            vscode.setState({ ...vscode.getState(), chatHistory: chatHistory });

            document.querySelector('.chat .chat-placeholder')?.remove();
        }
    });
});

