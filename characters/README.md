# 角色包

**这里只有露娜。** 引擎与角色完全解耦——加角色只需要一份 persona 文本，引擎一行都不用改。

| id | 角色 | 一句话 | 反差钩子 |
| --- | --- | --- | --- |
| `luna` | 露娜 | 魔界小恶魔，雌小鬼毒舌 | 嘴硬到底，**被反杀就怂**；说「人类最弱了」，你生病时急得来回飞 |

其余 9 位（小喵 / 三千代 / 绯音 / 凛 / 芽衣 / 白夜 / 阿尔玛 / 小铃 / 灰）归档在 `extras` 分支：

```bash
git checkout extras     # 完整 10 位
git checkout main       # 回到露娜
```

它们身上的写法已经提炼进 [`persona-template/ADVANCED.md`](../persona-template/ADVANCED.md)——角色归档了，经验留下来。

## 造一个角色（生成插件包）

从 `main` 上的这一位出发，生成一个可独立安装的插件包：

```bash
node scripts/install-character.mjs list              # 看有哪些角色（main 上只有 luna）
node scripts/install-character.mjs build hui         # → dist/hui/（package.json + cordis.patch.yml + 引擎）
node scripts/install-character.mjs build hui --out ~/work/hui-preset
dsh plugin add ~/work/hui-preset                     # 装进当前 profile
```

生成器做的事：

```
persona/<id>.md          ──┐
agent.cordis.yml（工具面）─┼─→  dist/<id>/
package.json + 引擎模块    ──┘        ├── agent.cordis.yml   （照抄，只换 prefix 那一段）
                                      ├── cordis.patch.yml   （preset 声明行，id/name/description 换掉）
                                      ├── package.json       （dsh.bundle + dsh.preset）
                                      └── luna-*.mjs ×12     （引擎，原样复制）
```

装完**重启 DSH**，新角色就会出现在选择器里。

> 这条路径只适合「自己造、自己装」。想长期维护一个角色，直接把生成出来的目录变成独立仓库更省事。

## 为什么这些角色不容易「丢人设」

对比过本机 5 个老 preset 后发现：它们的 persona 段落结构几乎一致（都有【思考模式】【表达技巧】【调节底线】【工作守则】），
**唯一的实质差异是露娜多了一段【行为模式】**。所以角色都按这套配方写：

| 配方 | 作用 |
| --- | --- |
| **【行为模式】写可执行动作** | 不写「她很害羞」，写「假装在占卜其实在偷看你，被发现了就低头擦根本不脏的铃铛」。动作比形容词更能锚住模型 |
| **【口头禅】≥4 条具体句子** | 给模型现成的句式，避免它自己「创作」角色口吻 |
| **【思考模式】写死「不许变回普通助手」** | 思考偷跑回分析口吻，是丢人设最常见的第一步 |
| **【调节底线】写边界** | 毒舌可以，伤人不行；被挑衅要稳住，不跟着崩 |
