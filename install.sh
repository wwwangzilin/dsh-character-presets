#!/usr/bin/env bash
# 露娜模式 · 一键安装
#
# 把 dsh-character-presets 装进 DeepSeek Harness 的 agent-presets 目录。
#
#   curl -fsSL https://raw.githubusercontent.com/wwwangzilin/dsh-character-presets/main/install.sh | bash
#   # 或
#   ./install.sh
#
# 可覆盖的环境变量：
#   DSH_HOME          DSH 主目录（默认 ~/.dsh）
#   DSH_PRESETS_DIR   预设目录（默认 $DSH_HOME/.agent-presets）
#   LUNA_REPO         源仓库（默认 GitHub 上的本仓库）
#   LUNA_REF          分支 / tag（默认 main）
set -euo pipefail

REPO="${LUNA_REPO:-https://github.com/wwwangzilin/dsh-character-presets.git}"
REF="${LUNA_REF:-main}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PRESETS_DIR="${DSH_PRESETS_DIR:-$DSH_HOME_DIR/.agent-presets}"
TARGET="$PRESETS_DIR/luna"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

say "露娜模式 · 安装"
say "  源仓库 : $REPO ($REF)"
say "  安装到 : $TARGET"

command -v git >/dev/null 2>&1 || die "未找到 git，请先安装 git"

if [ -e "$TARGET" ] && [ ! -d "$TARGET/.git" ]; then
  die "$TARGET 已存在且不是 git 仓库 —— 请先移走它，或改用 DSH_PRESETS_DIR 指定别处"
fi

mkdir -p "$PRESETS_DIR"

if [ -d "$TARGET/.git" ]; then
  say "  → 已安装过，执行更新"
  git -C "$TARGET" fetch --depth 1 origin "$REF"
  git -C "$TARGET" checkout -q "$REF" 2>/dev/null || true
  git -C "$TARGET" pull --ff-only origin "$REF"
else
  git clone --depth 1 --branch "$REF" "$REPO" "$TARGET"
fi

# DSH 用目录名作为 preset id，必须叫 luna
[ "$(basename "$TARGET")" = "luna" ] || die "目录名必须是 luna（当前：$(basename "$TARGET")）"
[ -f "$TARGET/preset.yml" ] || die "安装不完整：缺少 preset.yml"
[ -f "$TARGET/agent.cordis.yml" ] || die "安装不完整：缺少 agent.cordis.yml"

cat <<EOF

✅ 露娜已就位（$TARGET）

下一步：
  1. 重启 DSH
  2. 新建会话 → preset 选择器里选「露娜模式」
     或「设置 → Agent 预设」把它设为默认，之后每个新会话都由她来跑

换 DSH 目录？先设置 DSH_HOME（或 DSH_PRESETS_DIR）再重跑本脚本。
卸载：删掉 $TARGET 即可（她的记忆文件 .luna-heart.json 在工作区或 \$DSH_HOME 下，一并删掉即重置关系）。
EOF
