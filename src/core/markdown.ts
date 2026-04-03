import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface MarkdownInput {
  path: string;
  content: string;
}

export async function readMarkdownFile(filePath: string, cwd = process.cwd()): Promise<MarkdownInput> {
  const absolutePath = resolve(cwd, filePath);
  const content = (await readFile(absolutePath, 'utf8')).trim();
  if (!content) {
    throw new Error(`Markdown file is empty: ${filePath}`);
  }
  return {
    path: absolutePath,
    content,
  };
}
