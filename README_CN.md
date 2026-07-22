# MeelChat

MeelChat 是一个面向少量自用用户的轻量 AI 对话应用。用户自行配置兼容 OpenAI 的 API 地址和 API Key，应用提供模型列表检测、图片与文本文件分析、PWA 和基于同步 Token 的多设备聊天记录同步。

本项目基于开源项目 NextChat 二次开发。上游版权和 MIT 许可证见 [LICENSE](./LICENSE)。

## 产品范围

当前保留的用户主流程：

- 配置自己的 API 地址和 API Key。
- 获取接口实际可用的模型，并只在聊天界面展示这些模型。
- 进行文本和图片对话。
- 上传文本类文件供 AI 在当前请求中分析。
- 使用独立同步 Token 在个人设备之间同步聊天记录。
- 使用 PWA、主题、字体和常用模型参数。

当前不提供账号注册、组织空间、计费、管理后台、多人共享会话和复杂冲突处理。面具市场、插件、MCP、绘图和上游 SaaS 引导等入口默认不向普通用户开放。

## 用户使用流程

1. 打开设置页，在模型服务商中选择 `OpenAI` 或其他兼容服务商。
2. 填写完整的 API 地址和 API Key。
3. 点击“获取模型列表”。成功后，聊天页只显示接口返回的模型；这一步也用于检查地址和 Key 是否可用。
4. 在云同步设置中选择 `Meel 文件同步`，填写同步地址和管理员分配的同步 Token。
5. 开启自动同步，然后开始对话。

API Key 可以随时更换。聊天记录同步只依赖同步 Token，不依赖 API Key。

## 图片与文件

- 单次最多选择 4 张图片。图片会随当前 AI 请求发送，并保存在当前设备的本地聊天记录中。
- 文本文件上限为 200KB，最多读取前 20,000 个字符。
- 支持常见文本、Markdown、CSV、JSON、日志、配置和源代码文件。
- PDF、Word、Excel 等二进制办公文档当前不支持直接解析。
- 图片、文件本体和文本文件正文都不会上传到 Meel 同步服务器。
- 其他设备只会看到 `[图片未同步]` 或 `[文件未同步: 文件名]` 占位。

## Meel 文件同步

服务端接口：

```text
GET  /api/meel-sync/state
PUT  /api/meel-sync/state
Authorization: Bearer <sync-token>
```

服务端通过同步 Token 的 SHA-256 哈希识别用户。每个用户对应一个独立 JSON 文件，浏览器不会获得其他用户的 userId 或文件路径。

### 同步内容

同步以下 Zustand store：

- `chat-next-web-store`：会话和消息历史。
- `app-config`：非敏感界面与模型参数。
- `mask-store`：本地预设数据。
- `prompt-store`：自定义提示词。

不会同步：

- API Key、Base URL、Endpoint、页面访问码和同步 Token。
- WebDAV、Upstash 和 Access Store 配置。
- Cookie、Authorization header、图片、文件正文和其他附件本体。
- 键名或值中包含 `sk-`、`Bearer `、`apiKey`、`password`、`secret`、`token`、`accessCode`、`baseUrl`、`endpoint` 的数据。

严格过滤会同时排除 `max_tokens`、`tokenCount` 等名称中包含 `token` 的非敏感字段。

### 自动同步时机

- 所有本地 store 完成 hydration 后首次 pull。
- PWA 从后台回到前台且距离上次 pull 超过 60 秒时 pull。
- AI 回复完成或失败后 push。
- 新建、删除、重命名会话和编辑消息后延迟 3 秒 push。
- 页面隐藏或关闭前尽力 push。
- 失败时保留本地 dirty 状态，网络恢复或点击顶部状态可重试。

第一版按会话 ID 和消息 ID 合并，不处理两台设备同时编辑同一会话的复杂冲突。建议同一时间只在一台设备上编辑。

## 环境变量

同步服务需要：

```dotenv
MEEL_SYNC_ENABLED=1
MEEL_SYNC_DIR=/data/nextchat-sync
MEEL_SYNC_MAX_BYTES=10485760
MEEL_SYNC_USERS=user1:<sha256-token-a>,user2:<sha256-token-b>
```

变量说明：

| 变量                  | 说明                                            |
| --------------------- | ----------------------------------------------- |
| `MEEL_SYNC_ENABLED`   | 设为 `1` 启用同步 API。                         |
| `MEEL_SYNC_DIR`       | 用户 JSON 文件目录。生产环境必须持久化挂载。    |
| `MEEL_SYNC_MAX_BYTES` | 单用户同步请求大小限制，默认 10MB。             |
| `MEEL_SYNC_USERS`     | `userId:tokenSha256` 映射，多个用户用逗号分隔。 |

完整可选变量见 [.env.template](./.env.template)。真实 Token、API Key、SSH 凭据不得写入仓库。

生成同步 Token 哈希：

```shell
node -e "console.log(require('crypto').createHash('sha256').update('replace-with-user-token').digest('hex'))"
```

`MEEL_SYNC_USERS` 只保存哈希。用户客户端填写的是原始同步 Token。

## 本地开发

建议使用 Node.js 18 和 Yarn 1.22：

```shell
yarn install --frozen-lockfile
yarn dev
```

PowerShell 本地同步示例：

```powershell
$env:MEEL_SYNC_ENABLED="1"
$env:MEEL_SYNC_DIR="E:\workspace\local\MeelChat\.test-tmp\manual-sync"
$env:MEEL_SYNC_MAX_BYTES="10485760"
$env:MEEL_SYNC_USERS="user1:<sha256-token-a>,user2:<sha256-token-b>"
yarn dev
```

打开 [http://localhost:3000](http://localhost:3000)。同步地址可填写 `/api/meel-sync/state`。

## 测试

提交前至少执行：

```shell
yarn test:ci
yarn build
```

重点测试文件：

- `test/meel-sync.test.ts`：服务端鉴权、隔离、原子写入、过滤与合并。
- `test/meel-sync-client.test.ts`：客户端地址、Token 和错误处理。
- `test/model-list.test.ts`：模型列表接口兼容性。
- `test/model-list-config.test.ts`：聊天模型白名单。
- `test/attachments.test.ts`：文件正文只进入 AI 请求，不进入本地历史和同步状态。

手工验收至少覆盖：

1. 错误同步 Token 返回失败且不影响聊天。
2. 两个 Token 分别写入不同用户文件。
3. 第二台设备首次打开能拉取第一台设备历史。
4. API Key 和 Base URL 更换后同步仍可用。
5. 同步目录中搜索不到 API Key、同步 Token、Base URL 或 `sk-`。
6. 图片和文件在另一台设备上只显示占位。
7. iPhone/iPad 前后台切换不会重复消息或遮挡输入框。

## Docker 与发布

生产镜像由 GitHub Actions 构建并推送到公开 GHCR：

```text
ghcr.io/qq869588315/meelchat:latest
ghcr.io/qq869588315/meelchat:sha-<commit>
```

相关工作流：

- `.github/workflows/docker.yml`：`main` 推送后构建并发布镜像。
- `.github/workflows/test.yml`：`main` 推送和 Pull Request 时运行测试。
- `.github/workflows/sync.yml`：只允许手动同步上游，禁止定时覆盖定制代码。

标准发布流程：

1. 本地执行测试和生产构建。
2. 提交并推送 `main`。
3. 等待 GitHub Actions 测试和镜像构建成功。
4. 阿里云服务器拉取新镜像并无构建重启。
5. 检查 MeelChat 和同服务器核心站点。

阿里云服务器只有 2C2G，禁止执行：

```shell
docker build
docker compose build
docker compose up --build
```

服务器只执行：

```shell
docker compose pull
docker compose up -d --no-build
```

同步目录必须持久化挂载：

```text
/data/nextchat-sync:/data/nextchat-sync
```

生产 SSH 使用 AgentsMemory 中的 `meelapps.production.alicloud.ssh_root`。真实同步 Token 和服务器环境变量只保存在 AM 或服务器 `.env` 中。

## 维护原则

- 不把完整 Access Store 加入同步状态。
- 新增 store 字段时先确认是否包含密钥、地址、Token 或附件数据。
- 新增附件类型时同时验证本地存储、AI 请求和同步过滤三个边界。
- 不直接自动合并上游代码；先在本地审查、测试，再按需引入。
- 不在阿里云服务器构建镜像。
- 不提交真实密钥、Token、Cookie、服务器密码或用户聊天数据。
