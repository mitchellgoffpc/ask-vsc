import * as Diff from 'diff';

export function findBestMatch(input: string, replacement: string): [number, number] {
    let inputLines = input.split('\n');
    let replacementLines = replacement.split('\n');

    let lineCounts = new Map<string, number>();
    for (const line of replacementLines) {
        lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }

    let bestScore = Infinity;
    let bestRange: [number, number] = [0, 0];

    for (let i = 0; i < inputLines.length; i++) {
        let linesToAdd = new Map(lineCounts);
        let numLinesToAdd = replacementLines.length;
        let numLinesToRemove = 0;

        for (let j = i; j < inputLines.length; j++) {
            let line = inputLines[j];
            let lineCount = linesToAdd.get(line) ?? 0;
            if (lineCount > 0) {
                linesToAdd.set(line, lineCount - 1);
                numLinesToAdd -= 1;
            } else {
                numLinesToRemove += 1;
            }

            let score = numLinesToAdd + numLinesToRemove;
            if (score <= bestScore)  {
                bestScore = score;
                bestRange = [i, j];
            }
        }
    }

    return bestRange;
}

export function getDiff(input: string, replacement: string): string {
    let [start, end] = findBestMatch(input, replacement);
    let inputRange = input.split('\n').slice(start, end + 1).join('\n');
    return Diff.createPatch('string', inputRange, replacement);
}

export function replace(input: string, replacement: string): string {
    let [start, end] = findBestMatch(input, replacement);
    let inputLines = input.split('\n');
    let resultLines = [
        ...inputLines.slice(0, start),
        ...replacement.split('\n'),
        ...inputLines.slice(end + 1)
    ];
    return resultLines.join('\n');
}
