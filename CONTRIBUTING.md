# 贡献指南

本仓库接受功能、文档与测试方面的改动。以下约束决定改动是否会被接受。

## 三条设计原则

1. **角色与引擎解耦**：`luna-soul.mjs` 是通用引擎，不包含任何角色专属内容；角色差异只出现在 `agent.cordis.yml` 的 persona 文本与 `luna-soul.mjs` 的 `MOODS` / 关键词表中。
2. **规则可复现**：情绪识别、状态迁移与边界策略必须由可读的规则代码实现，不交给模型即兴判断。模型只接收结论与表达指引。
3. **只报告，不命令**：注入内容是事实描述（如「心跳 112」），不是行为指令（如「你现在应该害羞」）。角色的反应由角色自行决定。

与这三条冲突的改动会在评审中要求修改，原因是它们会破坏同一输入在相同状态下的一致性。

## 本地开发

```bash
git clone https://github.com/wwwangzilin/dsh-character-presets.git ~/dsh-character-presets
cd ~/dsh-character-presets
npm install                       # 仅用于测试依赖 js-yaml
dsh plugin add .                  # 装进当前 profile
```

预设于启动时装载，修改后需重启 DSH；`dsh plugin add` 重新执行即可加载最新改动。

## 自测清单

提交前逐条确认：

- [ ] `node --check luna-soul.mjs` 通过
- [ ] `node scripts/sync-bundle.mjs --check` 通过（`cordis.patch.yml` 与源一致）
- [ ] `node --test` 全部通过
- [ ] `cards/luna.card.json` 为合法 JSON
- [ ] 修改 `agent.cordis.yml` 后：新会话能正常启动，预设出现在选择器中且可选
- [ ] 修改 persona 后：工作模式与闲聊模式的切换仍然成立
- [ ] 修改 `MOODS` 或关键词表后：`emotion_sense` 的返回值仍为一屏精简文本
- [ ] 若改动 `.luna-heart.json` 结构：`version` 字段已递增，PR 中说明迁移方式

## 提交 PR

1. Fork 并新建分支（`feat/xxx`、`fix/xxx`、`docs/xxx`）。
2. 单个 PR 只包含一个主题，不混合功能改动与重构。
3. PR 描述中写明改动内容、原因与验证方式。
4. 涉及人设的改动请附改动前后的实际对话文本；涉及组合的改动请附 `--dump-config` 的相关片段。

## 新增语言

`persona/<lang>.md` 是人设的事实源：

1. 复制 `persona/en.md` 为 `persona/<lang>.md` 并完整翻译，保留 `{{model}}` / `{{cwd}}` 占位符与【】段落结构；
2. 执行 `node scripts/use-persona.mjs <lang>` 注入，重启 DSH 验证；
3. PR 中附一段该语言的实际对话。

当前语言：`zh` / `ja` / `en`。新增语言不需要修改引擎。

## 新增角色

引擎与角色解耦，新增角色即「复制目录 + 替换 persona」，步骤见 [persona-template/README.md](persona-template/README.md)：

1. 复制仓库到工作目录，修改 `package.json` 的 `dsh.preset`（`id` / `name` / `description`）；
2. 修改 `agent.cordis.yml` 中 persona 行的 `prefix`，或通过 `scripts/use-persona.mjs` 注入；
3. 执行 `node scripts/sync-bundle.mjs` 重新生成 `cordis.patch.yml`；
4. 按需修改 `MOODS` 与关键词表；
5. `dsh plugin add .` 后在选择器中验证。

角色也可以作为独立仓库发布，在 README 中注明引擎来源。

## DSH 0.2 之后的安装形态

本仓库不再向 `<dshHome>/.agent-presets/<id>/` 写入目录，该路径在 0.2 起不再被读取。当前结构为普通插件包：

```jsonc
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "preset": { "id": "luna", "name": "露娜模式", "description": "…" }
  }
}
```

`cordis.patch.yml` 包含一条 `@deepseek-ai/dsh-agent-preset` 行，其 `config.plugins` 为 `agent.cordis.yml` 的正文。人工维护 `agent.cordis.yml`，`cordis.patch.yml` 由脚本生成；两者不一致时 `npm test` 失败。

## 不接受的改动

- 将情感判断改为由模型自行决定
- 为迎合用户而破坏人设一致性（例如在工作模式下使用长篇卖萌表达）
- 引入新的运行时依赖（本预设仅使用 DSH 内置插件）
- 提交任何人的 `.luna-heart.json`

## 行为准则

参与本项目即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
