import React, { useContext } from 'react';
import * as API from '../api';
import { Message, StateContext } from '../context';
import MessageView from './Message';
import TextInput from './TextInput';

const CHAT_PLACEHOLDER = "Ask a question and the response will appear here.";

export default function Sidebar() {
    let { messages, files } = useContext(StateContext);

    return (
        <div className="sidebar">
            <div className="chat-files">
                {files.map((file: string) =>
                    <li key={file} className="file">
                        <span>{file}</span>
                        <i className="codicon codicon-close" onClick={() => API.removeFile(file)} />
                    </li>)}
            </div>

            <div className="chat-output">
                {messages.length
                  ? <div className="messages">
                        {messages.map((msg: Message, i: number) =>
                            <MessageView key={i} role={msg.role} content={msg.content} />)}
                    </div>
                  : <span className="placeholder">{CHAT_PLACEHOLDER}</span>}
            </div>

            <TextInput />
        </div>
    );
}
