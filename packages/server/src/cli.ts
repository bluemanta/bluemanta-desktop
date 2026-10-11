#!/usr/bin/env node
import { runServerCommand } from './run.js';

const result = await runServerCommand({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
});

if (typeof result === 'number') {
  process.exitCode = result;
} else {
  const stop = () => {
    result.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
