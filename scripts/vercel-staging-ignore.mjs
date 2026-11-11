// Vercel: exit 0 skips the build; exit 1 continues. Run from apps/web.
const build = process.env.VERCEL_GIT_COMMIT_REF === 'staging';
console.log(build ? 'Building the staging branch.' : 'Skipping a non-staging branch.');
process.exitCode = build ? 1 : 0;
