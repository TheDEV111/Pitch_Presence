# GitHub credentials and token exposure

PitchPresence does not need a GitHub personal access token to run. Keep GitHub
credentials in your developer credential manager or deployment secret store,
outside app source, public assets, `NEXT_PUBLIC_*` variables, and Git remote URLs.

The local audit found no GitHub token in tracked files, 145 reachable history
blobs, or 57 frontend build/public files. An exact-value scan of those frontend
files also found none of the configured database, session, QR, Resend, or Paystack
secrets. The frontend has no application console logging calls. This audit does
not inspect an existing browser's console history or previously published copies.

Tokens were found in the local Git configuration, plaintext Git credential store,
and Bash history. Those locations are not application files, and `.git/config`
is not part of a commit. The workspace mounts Git metadata read-only; the
credential store and history are outside its writable roots. Run cleanup in your
own terminal after revoking the exposed token in **GitHub Settings → Developer
settings → Personal access tokens**. [GitHub recommends revocation or rotation
first when a credential has been exposed](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

## Clean local copies

Close other terminals first so their in-memory history cannot restore token-bearing
commands. From the project root in your own Bash terminal:

```sh
npm run security:clean:local
npm run security:clean:local -- --apply
history -c
history -r
```

The first command previews changes and the second applies them. Cleanup removes
HTTPS user credentials from GitHub URLs in `.git/config` and removes only
GitHub-token-bearing lines from `~/.git-credentials`,
`~/.config/git/credentials`, `~/.bash_history`, and `~/.zsh_history` if present.
It keeps unrelated entries and file permissions, writes sanitized temporary files,
and does not create token-containing backups. A write failure is reported without
printing credential contents. Bash's last two commands reload the cleaned history.
For another shell, reload its history or start a new terminal after cleanup.
Plaintext tokens in any custom credential-store location need separate cleanup.

Revocation is a separate GitHub action; this script does not revoke tokens,
replace your authentication method, change GitHub account settings, or remove
already displayed terminal/chat output. Authenticate again using a credential
manager that supports your operating system's secure keychain; do not put a new
token in a remote URL or application `.env`.

## Prevent new app exposures

```sh
npm run security:check
npm run build -w @pitchpresence/web
npm run security:check:browser
```

CI runs both scans. The first inspects Git-tracked working-tree files; the second
also inspects production static files, rendered app output, and public assets.
Missing browser build directories fail the browser check. Findings identify file
paths and line numbers, never token values. The detector recognizes current
GitHub token prefixes; it is not a general-purpose secret scanner and does not
inspect Git history, ignored files, local credential stores, or remote copies.
