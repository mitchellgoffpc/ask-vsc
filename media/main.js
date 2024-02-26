const vscode = acquireVsCodeApi();

function autogrow(element) {
    element.style.height = "5px";
    element.style.height = (element.scrollHeight) + "px";
}

document.addEventListener('DOMContentLoaded', function() {
    let chatInput = document.querySelector('.chat-input textarea');
    chatInput.value = vscode.getState()?.text || "";
    autogrow(chatInput);
    chatInput.focus();
    chatInput.addEventListener('input', () => {
        vscode.setState({ text: chatInput.value });
        autogrow(chatInput);
    });
});

