export type Chunk = {
    lang: string | null,
    text: string,
};

export function parseCodeChunks(input: string): Chunk[] {
  let codeChunkRegex = /^```([\S]*)\n([\s\S]*?)\n```/gm;
  let codeChunks: Chunk[] = [];
  for (let match of input.matchAll(codeChunkRegex)) {
    if (match[2].trim()) {
      codeChunks.push({lang: match[1] || null, text: match[2].trim()});
    }
  }
  return codeChunks;
}
