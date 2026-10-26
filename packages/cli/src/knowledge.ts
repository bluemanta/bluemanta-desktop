#!/usr/bin/env node
import { runKnowledge } from './run-knowledge.js';

process.exitCode = runKnowledge({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
});
