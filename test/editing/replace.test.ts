import { strict as assert } from 'assert';
import { replace } from '../../src/editing/replace';

const input = ["line1", "line2", "line3", "line1"].join('\n');

suite('editing/replace.ts', () => {
  test('it should perform an insertion in the middle of a string', () => {
    const replacement = ["line3", "lineX", "line1"].join('\n');
    const expected = ["line1", "line2", "line3", "lineX", "line1"].join('\n');
    const actual = replace(input, replacement);
    assert.deepEqual(actual, expected);
  });

  test('it should perform a deletion in the middle of a string', () => {
    const replacement = ["line1", "line2", "line1"].join('\n');
    const expected = ["line1", "line2", "line1"].join('\n');
    const actual = replace(input, replacement);
    assert.deepEqual(actual, expected);
  });

  test('it should perform a replacement in the middle of a string', () => {
    const replacement = ["line1", "line2", "lineX", "line1"].join('\n');
    const expected = ["line1", "line2", "lineX", "line1"].join('\n');
    const actual = replace(input, replacement);
    assert.deepEqual(actual, expected);
  });
});