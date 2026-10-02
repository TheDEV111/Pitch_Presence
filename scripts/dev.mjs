import { spawn } from 'node:child_process';
const children = ['dev:api', 'dev:web'].map((script) =>
  spawn('npm', ['run', script], { stdio: 'inherit' }),
);
function stop() {
  for (const child of children) child.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
for (const child of children)
  child.on('exit', (code) => {
    if (code) {
      stop();
      process.exitCode = code;
    }
  });
