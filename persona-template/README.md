# persona-template

构造新角色的模板与检查清单。

引擎与角色相互独立：`luna-soul.mjs` 不接受任何角色标识，只处理情绪、状态与边界；角色身份仅存在于 persona 文本、`MOODS` 的风格句与关键词表中。因此新增角色无需改动引擎。

## 步骤

```bash
# 1. 复制仓库到工作目录
cp -r dsh-character-presets ~/work/dsh-character-preset-<id>
cd ~/work/dsh-character-preset-<id>

# 2. 编写人设并注入
#    编辑 persona/<lang>.md，或直接使用本目录的 persona.md
node scripts/use-persona.mjs <lang>

# 3. 更新元信息并重新生成补丁
#    编辑 package.json 的 dsh.preset（id / name / description）
node scripts/sync-bundle.mjs

# 4. 安装
dsh plugin add .
```

## 需要修改的位置

| 位置 | 内容 | 必需 |
| --- | --- | --- |
| `persona/<lang>.md` | 身份、人设、口头禅、行为模式、反差、表达技巧、工作守则 | 是 |
| `package.json` 的 `dsh.preset` | `id`、`name`（选择器显示名）、`description` | 是 |
| `luna-soul.mjs` 的 `MOODS` | 各心情档位的风格描述与示例句 | 强烈建议 |
| `luna-emotion.mjs` 的 `EXPLICIT_RULES` / `NEGATIONS` / `MIXED_PATTERNS` | 情绪关键词与判据 | 建议 |
| `luna-vitals.mjs` 的 `SENSATIONS` | 局部体感表，按角色特征替换（耳朵、尾巴、指尖、后颈） | 建议 |
| `luna-soul.mjs` 的 `needTable` / `regulate` | 安抚与边界话术 | 建议 |
| `cards/` | 其他前端使用的角色卡 | 可选 |

不建议改动引擎的分层结构（感知 → 理解 → 状态 → 表达 → 调节 → 记忆）与规则可复现原则；设计约束见仓库根目录 [CONTRIBUTING.md](../CONTRIBUTING.md)。

不要手工编辑 `cordis.patch.yml`：它是 `scripts/sync-bundle.mjs` 依据 `agent.cordis.yml` 与 `package.json` 生成的产物，手工修改会在下次生成时被覆盖，`npm test` 也会报告不一致。

## 检查清单

- [ ] `node --check luna-soul.mjs` 通过
- [ ] `node scripts/sync-bundle.mjs --check` 通过
- [ ] `node --test` 全部通过
- [ ] `node scripts/preview.mjs` 输出的对照表符合目标角色
- [ ] `node scripts/use-persona.mjs <lang> --dry-run` 的缩进与行数正常
- [ ] `dsh plugin add .` 后重启 DSH，预设出现在选择器中且可选中
- [ ] `emotion_sense` 返回目标角色的风格与示例
- [ ] 进入工作场景后表达收敛，未出现干扰性卖萌

## 发布

可将角色作为独立仓库发布，并在 README 中注明引擎来源为
[dsh-character-presets](https://github.com/wwwangzilin/dsh-character-presets)。`package.json` 中声明 `dsh.bundle` 后，该仓库即具备完整的 `dsh plugin add` 安装能力。
