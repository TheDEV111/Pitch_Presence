// Return locations only. Token values must never appear in scan output.
export function githubTokenLines(content) {
  return content
    .split('\n')
    .flatMap((line, index) =>
      /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/.test(line) ? [index + 1] : [],
    );
}

export function safePath(path) {
  return path.replace(/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[REDACTED]');
}

export function cleanGithubCredentialUrls(content) {
  return content.replace(/https?:\/\/[^\s/"@]+@github\.com(?=[/:\s"]|$)/gi, (match) => {
    const url = new URL(match);
    url.username = '';
    url.password = '';
    // The match ends at the hostname; leave the original repository path intact.
    return `${url.protocol}//${url.hostname}`;
  });
}

export function removeGithubTokenLines(content) {
  return content
    .split(/(?<=\n)/)
    .filter((line) => githubTokenLines(line).length === 0)
    .join('');
}
