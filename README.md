# SCOUT 终端联机

2–5 位玩家各用一个终端。独立客户端自带运行时，在 `scout` 文件所在目录运行 `./scout` 即可试玩。本机构建产物位于 `dist/scout`，可把它单独复制给使用相同系统与架构的朋友。

使用 Apple Silicon Mac 的玩家可以从 GitHub Release 的 Assets 下载 `scout-macos-arm64.tar.gz`，解压后在终端运行 `./scout`。

## 和朋友开一桌

进入游戏后，牌桌会占满当前终端。房间码在顶部，回合与按键提示在底部。窗口较矮时，可用 ↑ ↓ 滚动牌桌。按 Ctrl+C 退出会回到原来的命令行。

房主运行下面的命令，把终端顶端的六位房间码发给朋友。

```sh
./scout create 阿青
```

朋友在各自的客户端目录运行以下命令，将 `ABC234` 换成收到的房间码。所有人坐好后，房主按 Enter 发牌。客户端默认连接已部署的 Cloudflare 房间服务。

```sh
./scout join ABC234 小林
```

网络中断时客户端会自动重连。关闭程序后，在同一台电脑上运行 `./scout resume ABC234` 回到原座位。座位凭证按服务器和房间保存在 `~/.scout`。同一台电脑模拟多个玩家时，给每位玩家设置独立的 `SCOUT_HOME` 目录。

## 本地试玩

```sh
./scout
```

一人即可和四个机器人打完整场。开局按 Enter 保留方向，轮到你时按 S，向右移到 3，按空格定起点，再向右移到 5，按 Enter 打出顺子。下一次轮到你时，可以用 B 从右端取 9、翻成 4、插在手中原有的 4 旁，选出对子后确认。

| 操作 | 键位 |
| --- | --- |
| 开轮选方向 | R 旋转整手，Enter 锁定 |
| Show | S 进入，← → 移动，空格设定或解除起点，Enter 出牌 |
| Scout | C 进入，E 换端，R 翻牌，← → 选插入点，Enter 预览后再确认 |
| Scout & Show | B 进入，先抓牌再选出牌区间，最后一次确认提交整步 |
| 调整或离开 | Esc 返回上一步，Ctrl+C 退出 |

牌面中央的大数字是当前点数，右下角的小数字是翻转后的备用点数。窄终端会按牌序换行。选区下方有括线，新插入的牌标记为 ▼。

轮到你行动时，客户端会提醒一次。iTerm2、Ghostty、WezTerm 和 kitty 使用桌面通知，其他终端以及 tmux、screen 使用终端响铃。横幅、声音或标签页闪烁取决于终端和系统的通知设置。双人局连续 Scout 仍属同一回合。

## 开发和验证

源码开发使用 Node.js 22.12 或更新版本与 pnpm 12.21.0，先运行 `pnpm install --frozen-lockfile`。用 `pnpm play` 启动源码客户端，子命令与独立程序相同。重新构建单文件客户端时，安装 Bun（本次使用 1.3.10），运行 `pnpm build`。它会为当前系统和架构生成程序，macOS 构建会做临时签名。

```sh
pnpm check
pnpm test
pnpm dev
```

本地 Worker 运行后，在另一个终端使用 `SCOUT_SERVER=http://127.0.0.1:8787 pnpm play create 阿青`。朋友和重连客户端需使用同一个服务器地址。`pnpm test:rooms` 默认对本地 Worker 打完三人局和双人局，校验各座位收到的牌面、断线重连、版本冲突与结算。可用 `SCOUT_SERVER` 指向自己的部署，用 `SCOUT_IDLE_MS=45000` 在开局后留出休眠时间。

使用有 Workers 部署权限的 Cloudflare 账号运行 `pnpm run deploy`。Wrangler 配置会绑定每桌一个 SQLite-backed Durable Object。规则、阶段目标和四张设计稿见[首版计划](PLAN.md)。

## 发布新版本

在 GitHub 的 Releases 页面选择版本标签，点击 **Publish release**。GitHub Actions 会针对该标签运行类型检查和测试，构建并校验 macOS 可执行文件，然后将压缩包附加到这次 Release。正式版和预发布版都会触发构建。
