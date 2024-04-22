import React from 'react';
import * as API from '../api';

const ROLE_NAMES: any = {
    user: "User",
    agent: "Agent",
};

function getDiffClass(indicator: string): string {
    return indicator === '+' ? 'add' : indicator === '-' ? 'remove' : '';
}

function getMarkdownLineHTML(line: string): string {
    return line
        .replace(/(\*\*\*([^\*]+)\*\*\*)/g, '<b><i>$2</i></b>')
        .replace(/(\*\*([^\*]+)\*\*)/g, '<b>$2</b>')
        .replace(/(\*([^\*]+)\*)/g, '<i>$2</i>')
        .replace(/(\`([^\`]+)\`)/g, '<code>$2</code>');
}

function renderMarkdownCode(lines: string[], lang: string): JSX.Element {
    let lineElements: JSX.Element[] = [];
    for (let line of lines) {
        if (line.match(/^\s*```/)) { break; }
        lineElements.push(
            <span className={getDiffClass(line[0])} key={line}>
                {line.startsWith('+') || line.startsWith('-') ? line.substring(1) : line}
            </span>
        );
    }
    return (
        <div className="code">
            <pre lang={lang}>{lineElements}</pre>
        </div>
    );
}

function renderMarkdown(input: string): JSX.Element {
    let lines = input.split('\n');
    let diffs: string[] = [];
    let elements: JSX.Element[] = [];
    let i = 0;

    while (i < lines.length) {
        let code_match = lines[i].match(/^\s*```([a-zA-Z0-9]+)/);
        if (code_match) {
            let lang = code_match[1];
            let codeBlock = renderMarkdownCode(lines.slice(i + 1), lang);
            let codeText = lines.slice(i + 1, i + codeBlock.props.children.length + 1).join('\n');
            elements.push(codeBlock);
            i += codeBlock.props.children.length + 2;
            if (lang === 'diff' && lines[i - 1] === '```') {
                diffs.push(codeText);
            }
        } else if (lines[i].startsWith('- ')) {
            let key = i;
            let listItems: JSX.Element[] = [];
            while (i < lines.length && lines[i].startsWith('- ')) {
                listItems.push(<li key={i} dangerouslySetInnerHTML={{__html: getMarkdownLineHTML(lines[i].substring(2))}} />);
                i++;
            }
            elements.push(<ul key={key}>{listItems}</ul>);
        } else if (lines[i].match(/^\d+\. /)) {
            let key = i;
            let listItems: JSX.Element[] = [];
            let startIndex = parseInt(lines[i].match(/^(\d+)\./)![1]);
            while (i < lines.length && lines[i].match(/^\d+\. /)) {
                let html = getMarkdownLineHTML(lines[i].split(/^\d+\. /)[1]);
                listItems.push(<li key={i} dangerouslySetInnerHTML={{__html: html}} />);
                i++;
            }
            elements.push(<ol key={key} start={startIndex}>{listItems}</ol>);
        } else {
            elements.push(<p key={i} dangerouslySetInnerHTML={{__html: getMarkdownLineHTML(lines[i])}} />);
            i++;
        }
    }

    if (diffs.length) {
        elements.push(
            <button key="approve" className="approve" onClick={() => {
                API.approveDiff(diffs.join('\n'));
            }}>
                Approve
            </button>
        );
    }

    return <div>{elements}</div>;
}

export default function Message({ role, content }: { role: string, content: string }) {
    return (
        <div className="message">
            <div className="header">{ROLE_NAMES[role]}</div>
            <div className="body">
                {renderMarkdown(content)}
            </div>
        </div>
    );
}
