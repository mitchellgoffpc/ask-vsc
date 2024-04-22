import React, { JSX } from 'react';
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

function renderMarkdown(input: string): JSX.Element {
    let lines = input.split('\n');
    let diffs: string[] = [];
    let elements: JSX.Element[] = [];
    let i = 0;

    while (i < lines.length) {
        let code_match = lines[i].match(/^\s*```([a-zA-Z0-9]+)/);
        if (code_match) {
            // CODE BLOCK
            let lang = code_match[1];
            let lineElements: JSX.Element[] = [];
            let startIndex = ++i;
            while (i < lines.length && !lines[i].match(/^\s*```/)) {
                let textContent = lang === 'diff' && lines[i].match(/^(?![\+\-]{2,})([\+\-\s])/) ? lines[i].substring(1) : lines[i];
                let className = lang === 'diff' ? getDiffClass(lines[i][0]) : '';
                lineElements.push(<span key={i} className={className}>{textContent + '\n'}</span>);
                i++;
            }
            elements.push(<div key={i} className="code"><pre lang={lang}>{lineElements}</pre></div>);
            if (lang === 'diff' && lines[i] === '```') {
                diffs.push(lines.slice(startIndex, i).join('\n'));
            }
            i++;
        } else if (lines[i].startsWith('- ')) {
            // UNORDERED LIST
            let listItems: JSX.Element[] = [];
            while (i < lines.length && lines[i].startsWith('- ')) {
                listItems.push(<li key={i} dangerouslySetInnerHTML={{__html: getMarkdownLineHTML(lines[i].substring(2))}} />);
                i++;
            }
            elements.push(<ul key={i-1}>{listItems}</ul>);
        } else if (lines[i].match(/^\d+\. /)) {
            // ORDERED LIST
            let listItems: JSX.Element[] = [];
            let startIndex = parseInt(lines[i].match(/^(\d+)\./)![1]);
            while (i < lines.length && lines[i].match(/^\d+\. /)) {
                let html = getMarkdownLineHTML(lines[i].split(/^\d+\. /)[1]);
                listItems.push(<li key={i} dangerouslySetInnerHTML={{__html: html}} />);
                i++;
            }
            elements.push(<ol key={i-1} start={startIndex}>{listItems}</ol>);
        } else {
            // NORMAL TEXT
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
