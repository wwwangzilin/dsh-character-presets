#!/usr/bin/env bash
# 露娜模式 · 一键安装
#
# DSH 0.2 起，agent preset 不再是一个放在 `.agent-presets/<id>/` 里的目录，而是一条
# bundle patch 里的 `@deepseek-ai/dsh-agent-preset` 行。所以本脚本做两件事：取插件包 →
# 交给官方 CLI `dsh plugin add`。
#
#   curl -fsSL https://raw.githubusercontent.com/wwwangzilin/dsh-character-presets/main/install.sh | bash
#   # 或
#   ./install.sh
#
# 可覆盖的环境变量：
#   DSH_HOME          DSH 主目录（默认 ~/.dsh）
#   DSH_PRESET_DIR    插件包落地目录（默认 $DSH_HOME/presets/luna）
#   DSH_PRESET_REPO   源仓库（默认 GitHub 上的本仓库）
#   DSH_PRESET_REF    分支 / tag（默认 main）
set -euo pipefail

REPO="${DSH_PRESET_REPO:-https://github.com/wwwangzilin/dsh-character-presets.git}"
REF="${DSH_PRESET_REF:-main}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
TARGET="${DSH_PRESET_DIR:-$DSH_HOME_DIR/presets/luna}"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

say "露娜模式 · 安装"
say "  源仓库 : $REPO ($REF)"
say "  安装到 : $TARGET"

command -v git >/dev/null 2>&1 || die "未找到 git，请先安装 git"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --depth 1 --branch "$REF" "$REPO" "$TMP/repo" || die "git clone 失败"
[ -f "$TMP/repo/package.json" ] || die "仓库里没有 package.json"
grep -q '"bundle"' "$TMP/repo/package.json" || die "$REF 分支还不是可安装的插件包（package.json 缺 dsh.bundle）"

mkdir -p "$(dirname "$TARGET")"
rm -rf "$TARGET"
cp -R "$TMP/repo" "$TARGET"
rm -rf "$TARGET/.git"

PRESET_NAME="$(sed -n 's/.*"name": "\(.*\)",\{0,1\}/\1/p' "$TARGET/package.json" | sed -n '2p')"

cat <<EOF

✅ 插件包已就位：$TARGET
   preset：${PRESET_NAME:-luna}

正在通过官方 CLI 安装到当前 profile…
EOF

if ! command -v dsh >/dev/null 2>&1; then
  die "PATH 里没有 dsh —— 装好后手动执行：dsh plugin add \"$TARGET\""
fi
dsh plugin add "$TARGET" || die "dsh plugin add 失败"

cat <<EOF

✅ 完成

下一步：
  1. 重启 DSH
  2. 新建会话 → preset 选择器里选「露娜模式」
     或「设置 → Agent 预设」把它设为默认，之后每个新会话都由她来跑

记忆文件：\$DSH_HOME/.luna-heart.json（删掉即重置关系）。
EOF
