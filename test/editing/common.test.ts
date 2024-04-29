import { strict as assert } from 'assert';
import { parseCodeChunks } from '../../src/editing/common';

const input = `
Here is some text
\`\`\`
const x = 1;
\`\`\`
More text
\`\`\`code
function hello() {
  console.log('Hello World');
}
\`\`\`
`;

suite('editing/common.ts', () => {
  test('it should parse code chunks correctly', () => {
    const expected = [
      {lang: null, text: 'const x = 1;'},
      {lang: 'code', text: 'function hello() {\n  console.log(\'Hello World\');\n}'}
    ];
    const actual = parseCodeChunks(input);
    assert.deepEqual(actual, expected);
  });

  test('it should return empty array for no code chunks', () => {
    const actual = parseCodeChunks('just some text');
    assert.deepEqual(actual, []);
  });
});
