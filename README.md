# MeelChat

MeelChat is a lightweight AI chat application for a small private user group. Users provide an OpenAI-compatible API endpoint and API key, while the app adds model discovery, image and text-file analysis, PWA support, and token-based multi-device chat history sync.

This project is derived from the open-source NextChat project. See [LICENSE](./LICENSE) for upstream copyright and the MIT license.

[简体中文](./README_CN.md)

## Product Scope

The primary user flow is intentionally small:

- Configure a personal API endpoint and API key.
- Fetch the models actually exposed by that endpoint and show only those models in chat.
- Chat with text and images.
- Attach text-like files for analysis in the current model request.
- Sync chat history between personal devices with an independent sync token.
- Use PWA, themes, fonts, and common model parameters.

MeelChat does not provide registration, organizations, billing, an admin portal, shared conversations, or complex concurrent conflict resolution. Advanced upstream entries such as mask discovery, plugins, MCP, image generation, and SaaS promotion are hidden from the normal user flow.

## User Flow

1. Open Settings and select `OpenAI` or another compatible provider.
2. Enter the full API endpoint and API key.
3. Select `Fetch model list`. A successful result confirms connectivity and limits the chat model picker to the returned models.
4. Under cloud sync, select `Meel file sync`, set the sync endpoint, and enter the sync token assigned by the administrator.
5. Enable automatic sync and start chatting.

The API key can be replaced at any time. History sync depends only on the sync token, never on the API key.

## Images And Files

- Up to four images can be selected for one message. Images are sent with the current model request and retained only in local chat storage.
- Text files are limited to 200KB and the first 20,000 characters.
- Common text, Markdown, CSV, JSON, log, config, and source code files are supported.
- Binary office formats such as PDF, Word, and Excel are not parsed yet.
- Images, file bodies, and text-file contents are never uploaded to the Meel sync server.
- Other devices receive only `[图片未同步]` or `[文件未同步: filename]` placeholders.

## Meel File Sync

Server API:

```text
GET  /api/meel-sync/state
PUT  /api/meel-sync/state
Authorization: Bearer <sync-token>
```

The server identifies each user by the SHA-256 hash of the sync token. Each user maps to one isolated JSON file; clients cannot select a user ID or file path.

### Synced Data

Only these Zustand stores are included:

- `chat-next-web-store`: sessions and message history.
- `app-config`: non-sensitive UI and model settings.
- `mask-store`: local preset data.
- `prompt-store`: custom prompts.

The following data is excluded:

- API keys, base URLs, endpoints, access codes, and sync tokens.
- WebDAV, Upstash, and Access Store configuration.
- Cookies, authorization headers, images, file bodies, and attachment data.
- Keys or values containing `sk-`, `Bearer `, `apiKey`, `password`, `secret`, `token`, `accessCode`, `baseUrl`, or `endpoint`.

Strict filtering also excludes non-sensitive names containing `token`, including `max_tokens` and `tokenCount`.

### Automatic Sync

- Initial pull after all persisted stores finish hydration.
- Pull when the PWA returns to the foreground and the last pull is older than 60 seconds.
- Push after an AI response completes or fails.
- Debounced push three seconds after session or message changes.
- Best-effort push when the page becomes hidden or closes.
- Dirty state is preserved after failures and retried when connectivity returns or the status bar is selected.

Version one merges by session and message IDs. Do not edit the same conversation on two devices at the same time.

## Environment

Required sync configuration:

```dotenv
MEEL_SYNC_ENABLED=1
MEEL_SYNC_DIR=/data/nextchat-sync
MEEL_SYNC_MAX_BYTES=10485760
MEEL_SYNC_USERS=user1:<sha256-token-a>,user2:<sha256-token-b>
```

| Variable              | Purpose                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `MEEL_SYNC_ENABLED`   | Set to `1` to enable the sync API.                                              |
| `MEEL_SYNC_DIR`       | Directory containing per-user JSON files. Persist this directory in production. |
| `MEEL_SYNC_MAX_BYTES` | Maximum request size per user, 10MB by default.                                 |
| `MEEL_SYNC_USERS`     | Comma-separated `userId:tokenSha256` mappings.                                  |

See [.env.template](./.env.template) for optional upstream provider settings. Never commit real tokens, API keys, or SSH credentials.

Generate a token hash:

```shell
node -e "console.log(require('crypto').createHash('sha256').update('replace-with-user-token').digest('hex'))"
```

`MEEL_SYNC_USERS` stores only hashes. Users enter the original token in their clients.

## Local Development

Node.js 18 and Yarn 1.22 are recommended:

```shell
yarn install --frozen-lockfile
yarn dev
```

PowerShell sync example:

```powershell
$env:MEEL_SYNC_ENABLED="1"
$env:MEEL_SYNC_DIR="E:\workspace\local\MeelChat\.test-tmp\manual-sync"
$env:MEEL_SYNC_MAX_BYTES="10485760"
$env:MEEL_SYNC_USERS="user1:<sha256-token-a>,user2:<sha256-token-b>"
yarn dev
```

Open [http://localhost:3000](http://localhost:3000). Use `/api/meel-sync/state` as the local sync endpoint.

## Verification

Run before every release:

```shell
yarn test:ci
yarn build
```

Key test files:

- `test/meel-sync.test.ts`: authentication, isolation, atomic writes, filtering, and merges.
- `test/meel-sync-client.test.ts`: endpoint, token, and client error handling.
- `test/model-list.test.ts`: model-list endpoint compatibility.
- `test/model-list-config.test.ts`: chat model allow-list behavior.
- `test/attachments.test.ts`: file bodies enter model requests but not history or sync state.

Manual acceptance should cover wrong tokens, two-user isolation, first pull on a second device, API key replacement, sensitive-data scans, attachment placeholders, and iPhone/iPad foreground transitions.

## Docker And Releases

GitHub Actions publishes public images to GHCR:

```text
ghcr.io/qq869588315/meelchat:latest
ghcr.io/qq869588315/meelchat:sha-<commit>
```

Workflows:

- `.github/workflows/docker.yml`: build and publish after pushes to `main`.
- `.github/workflows/test.yml`: test pushes to `main` and pull requests.
- `.github/workflows/sync.yml`: manual upstream sync only; scheduled upstream overwrites are disabled.

Release sequence:

1. Run local tests and the production build.
2. Commit and push `main`.
3. Wait for GitHub Actions tests and image publishing to succeed.
4. Pull and restart on Aliyun without building.
5. Verify MeelChat and the other core sites on the same server.

The Aliyun host has only 2 CPU cores and 2GB of memory. Never run:

```shell
docker build
docker compose build
docker compose up --build
```

The server may only pull and restart existing images:

```shell
docker compose pull
docker compose up -d --no-build
```

Persist the sync directory:

```text
/data/nextchat-sync:/data/nextchat-sync
```

Production SSH uses the AgentsMemory secret reference `meelapps.production.alicloud.ssh_root`. Real sync tokens and production environment values stay in AM or the server `.env` file.

## Maintenance Rules

- Never add the complete Access Store to sync state.
- Review every new store field for credentials, endpoints, tokens, and attachments.
- For new attachment types, verify model request, local persistence, and sync filtering separately.
- Do not automatically merge upstream changes; review and test them locally first.
- Never build production images on the Aliyun server.
- Never commit credentials, tokens, cookies, server passwords, or user conversations.
