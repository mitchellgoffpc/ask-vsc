import React, { useState, useEffect, useContext, useRef } from 'react';
import { MODELS, Model } from '../../api/models';
import { StateContext } from '../context';
import * as API from '../api';

const COMMANDS = ["/file", "/tab"];

type Option = {
    value: string;
    display: string;
    separator: string;
};

function autogrow(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "5px";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function getCursorLine(textarea: HTMLTextAreaElement, fromEnd: boolean = false): number {
    let bbox = textarea.getBoundingClientRect();
    let style = {position: 'absolute', top: 0, left: 0, visibility: 'hidden', width: `${bbox.width}px`, height: '5px'};
    let mirror = document.createElement('textarea');
    Object.assign(mirror.style, style);
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


export default function TextInput() {
    let textAreaRef = useRef<HTMLTextAreaElement>(null);
    let modelSelectRef = useRef<HTMLDivElement>(null);
    let {
        text, setText,
        historyOffset, setHistoryOffset,
        model, setModel,
    } = useContext(StateContext);

    let [showModelSelect, setShowModelSelect] = useState<boolean>(false);
    let [autocompleteOptions, setAutocompleteOptions] = useState<Option[]>([]);
    let [autocompleteActiveOption, setAutocompleteActiveOption] = useState("");
    let autocompleteIndex = Math.max(0, autocompleteOptions.findIndex(option => option.value === autocompleteActiveOption));


    // Autocomplete helpers

    function updateAutocompleteOptions(options: Option[]): void {
        if (textAreaRef.current) {
            let textarea = textAreaRef.current;
            let tagStart = textarea.value.lastIndexOf(' ', textarea.selectionStart) + 1;
            let tagValue = textarea.value.substring(tagStart, textarea.selectionStart);
            let validOptions = options.filter(option => option.value.startsWith(tagValue) && option.value !== tagValue);
            setAutocompleteOptions(validOptions);
        }
    }
    function fillAutocomplete(option: Option): void {
        let textarea = textAreaRef.current;
        if (textarea) {
            let tagStart = text.lastIndexOf(' ', textarea.selectionStart) + 1;
            let newText = text.substring(0, tagStart) + option.value + option.separator + text.substring(textarea.selectionEnd);
            textarea.value = newText;
            setText(newText);
            handleAutocompleteInput();
        }
    }


    // Event handlers

    function handleToggleModelSelect(event: React.MouseEvent) {
        event.stopPropagation();
        setShowModelSelect(!showModelSelect);
    }
    function handleSelectModel(event: React.MouseEvent, model: Model) {
        event.stopPropagation();
        setShowModelSelect(false);
        setModel(model);
    }

    function handleInputKeyDown(event: React.KeyboardEvent) {
        if (autocompleteOptions.length) {
            handleAutocompleteKeyDown(event);
        } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
        } else if (event.key === 'PageUp' || (event.key === 'ArrowUp' && textAreaRef.current && getCursorLine(textAreaRef.current) === 0)) {
            event.preventDefault();
            setHistoryOffset(historyOffset + 1);
        } else if (event.key === 'PageDown' || (event.key === 'ArrowDown' && textAreaRef.current && getCursorLine(textAreaRef.current, true) === -1)) {
            event.preventDefault();
            setHistoryOffset(historyOffset - 1);
        } else if (event.key === 'Tab') {
            event.preventDefault();
            setText(text + '\t');
        } else if (event.key === 'g' && event.ctrlKey) {
            API.unfocus();
        }
    }
    function handleInputChange(event: React.FormEvent) {
        let textarea = event.target as HTMLTextAreaElement;
        setText(textarea.value);
        handleAutocompleteInput();
    }

    function handleAutocompleteClick(event: React.MouseEvent, option: Option) {
        event.stopPropagation();
        fillAutocomplete(option);
    }
    function handleAutocompleteKeyDown(event: React.KeyboardEvent): void {
        let isUpKey = event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey);
        let isDownKey = event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey);
        let options = autocompleteOptions;
        let index = autocompleteIndex;

        if (event.key === 'Escape' || (event.key === 'g' && event.ctrlKey)) {
            event.preventDefault();
            setAutocompleteOptions([]);
        } else if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'ArrowRight' || (event.key === 'e' && event.ctrlKey)) {
            event.preventDefault();
            fillAutocomplete(options[index]);
        } else if (isUpKey || isDownKey) {
            event.preventDefault();
            let nextIndex = isDownKey
                ? (index + 1) % options.length
                : (index + options.length - 1) % options.length;
            setAutocompleteActiveOption(options[nextIndex].value);
        }
    }
    async function handleAutocompleteInput(): Promise<void> {
        let textarea = textAreaRef.current;
        if (!textarea) { return; }

        let command = textarea.value.match(/^\s*(\/\S*)/)?.[1];
        let commandArgMatch = textarea.value.match(/^\s*\/\S+\s+(\S*)/);
        let invalidCommand = commandArgMatch && command && !COMMANDS.includes(command);
        let commandComplete =  commandArgMatch && textarea.selectionStart > commandArgMatch[0].length;

        if (!command || invalidCommand || commandComplete) {
            updateAutocompleteOptions([]);
        } else if (!commandArgMatch) {
            updateAutocompleteOptions(COMMANDS.map(option =>
                ({ value: option, display: option, separator: " " })));
        } else if (command === '/tab') {
            let tabNames = await API.getTabs();
            updateAutocompleteOptions(tabNames.map(option =>
                ({ value: option, display: option, separator: " " })));
        } else if (command === '/file') {
            let filePaths = await API.getFiles(commandArgMatch?.[1] || "");
            let options = filePaths.map(({path, isDir}) => ({
                value: path,
                display: path.split('/').pop() || path,
                separator: isDir ? "/" : " "
            }));
            updateAutocompleteOptions(options);
        }
    }

    function handleSubmit() {
        const command = text.match(/^\s*(\/\S+)/)?.[1];
        const commandArg = text.match(/^\s*\/\S+\s+(\S*)/)?.[1];
        if (command) {
            API.sendCommand(command, commandArg ? [commandArg] : []);
        } else if (text.trim()) {
            API.sendQuery(text);
        }
    }

    function handleClickOutside(event: MouseEvent) {
        if (modelSelectRef.current && (!event.target || !modelSelectRef.current.contains(event.target as HTMLElement))) {
            setShowModelSelect(false);
        }
    }
    function handleFocusCommand() {
        if (textAreaRef.current) {
            textAreaRef.current.focus();
        }
    }


    // Effects

    useEffect(() => {
        if (textAreaRef.current) {
            autogrow(textAreaRef.current);
            textAreaRef.current.focus();
        }
    }, [textAreaRef, text]);

    useEffect(() => {
        API.addEventListener("focus", handleFocusCommand);
        return () => API.removeEventListener("focus", handleFocusCommand);
    }, []);

    useEffect(() => {
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);


    // Rendering

    return (
        <div className="chat-input">
            <div className="settings">
                <div className="model-select" ref={modelSelectRef} onClick={handleToggleModelSelect}>
                    <span className="model-name">{model.name}</span>
                    <i className="codicon codicon-chevron-up" />
                    <div className="model-options" style={{display: showModelSelect ? "block" : "none"}}>
                        {MODELS.map(model =>
                            <div key={model.name} onClick={e => handleSelectModel(e, model)}>
                                {model.name}
                            </div>)}
                    </div>
                </div>
            </div>

            <div className="input-box">
                <textarea className="message"
                          placeholder="Ask a question!"
                          value={text}
                          ref={textAreaRef}
                          onKeyDown={handleInputKeyDown}
                          onInput={handleInputChange} />

                <div className="submit" onClick={handleSubmit}>
                    <i className="codicon codicon-send"></i>
                </div>

                <div className="autocomplete" style={{display: autocompleteOptions.length ? "block" : "none"}}>
                    {autocompleteOptions.map((option, i) =>
                        <div key={option.value}
                             className={"option" + (i === autocompleteIndex ? " selected" : "")}
                             onClick={e => handleAutocompleteClick(e, option)}
                             onMouseMove={(() => setAutocompleteActiveOption(option.value))}>
                            {option.display}
                        </div>)}
                </div>
            </div>
        </div>
    );
}
