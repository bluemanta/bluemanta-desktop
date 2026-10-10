#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { runIdea } from './run-idea.js';

let stdin = '';
try {
  stdin = readFileSync(0, 'utf8');
} catch {
  process.stdout.write(`${JSON.stringify({ ok: false, code: 'invalid_input', message: '无法读取标准输入' })}\n`);
  process.exitCode = 1;
}

if (process.exitCode === undefined) {
  process.exitCode = runIdea({
    argv: process.argv.slice(2),
    stdin,
    env: process.env,
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  });
}
