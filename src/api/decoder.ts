import * as assert from 'assert';

export class LineDecoder {
    buffer: string;
    decoder: TextDecoder;

    constructor() {
        this.buffer = '';
        this.decoder = new TextDecoder("utf-8");
    }

    decode(input: Uint8Array): any[] {
        const decodedInput = this.decoder.decode(input);
        const combinedInput = this.buffer + decodedInput;
        this.buffer = '';

        let lines = combinedInput.split('\n');
        if (!lines[lines.length - 1].endsWith('\n')) {
            this.buffer = lines.pop() || "";
        }
        for (let line of lines) {
            assert.ok(!line || line.startsWith('data: '), `Invalid line: ${line}`);
        }
        return lines.filter(line => line.length > 0)
                    .map(line => line.substring("data: ".length))
                    .filter(line => line !== "[DONE]")
                    .map(line => JSON.parse(line));
    }
}
