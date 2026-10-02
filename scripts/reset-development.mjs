import { spawn } from 'node:child_process';
if (
  process.env.NODE_ENV !== 'development' ||
  !process.argv.includes('--confirm-development-data-loss')
) {
  console.error(
    'Development reset refused. Set NODE_ENV=development and pass --confirm-development-data-loss only after checking DATABASE_URL. This permanently removes all data in that database.',
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const child = spawn('npm', ['exec', '--', 'prisma', 'migrate', 'reset', '--force', '--skip-seed'], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
