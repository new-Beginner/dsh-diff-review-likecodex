<div align="center">

# DSH Diff Review Likecodex

**无需离开 DeepSeek Harness Web，即可立即审查 Agent 刚刚修改的每个文件。**

[![Adapted DSH CLI version](https://img.shields.io/badge/DSH_CLI-0.1.5--rc.1-4f46e5?style=flat-square)](package.json)
![Web profile](https://img.shields.io/badge/profile-Web-0ea5e9?style=flat-square)
[![MIT License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)

[English](README.md) · 简体中文

</div>

## 仓库与命名空间

`dsh-diff-review-likecodex` 代码仓库托管于 [new-Beginner/dsh-diff-review-likecodex](https://github.com/new-Beginner/dsh-diff-review-likecodex)。

本项目使用独立的 `diffReviewLikecodex` remote/service 命名空间、`diff-review-likecodex` settings/locale 命名空间、`dshDiffReviewLikecodex` 标记属性和 `diff-review-likecodex.deliverables` 轮次数据键。自有 UI/插件注册 ID 使用 `dsh-diff-review-likecodex:` 前缀。公共 DSH slot 保留框架原名；本项目不注册共享的 `chatFileMentions` 服务，避免与其他插件冲突。

历史兼容标记仅作为只读兼容数据，且只在不存在本项目标记时读取。Host 不会将旧标记当作自己的数据，也不会删除或重写它们。新评论使用 `<diff_review_likecodex_comments>`；历史 `<file_review_comments>` 消息仍可显示，但不会写入旧服务或设置。Cordis patch 只插入本项目，不再禁用 DSH 内置 deliverables 插件。

## 致谢与上游来源

本项目衍生并汲取自 [left0ver](https://github.com/left0ver) 开源的 [dsh-file-review](https://github.com/left0ver/dsh-file-review) 项目。在此向原作者致以由衷的感谢，感谢其为社区带来的初始创意与开源基石。

## 相较于原项目的改变与特性增强

1. **Codex 风格审查交互入口（方案 A）**：
   - 移除了会话顶部标题栏较为突兀的常驻“审查”按钮；
   - 保留并强化了原生右侧栏的审查页签以及消息流尾部卡片的审查快捷入口；
   - 引入运行中在输入框上方显示的紧凑型自适应悬浮审查条（运行中展示变动文件与状态，运行完成后自动淡出收起），提供更加平滑沉浸的审查体验；浮窗横条与交互入口设计未来亦可作为扩展组件直接并入到 `bettersider` (`dsh-better-sidebar`) 项目中。
2. **多轮变更加载与轮次隔离（Turn-scoped Changes）**：
   - 在右侧栏审查页引入轮次选择器（Turn picker），可精准回溯和加载指定单轮对话中的全部文件编辑记录，避免历史多轮改动混淆；
   - 路径别名聚合：同一工作区下文件的绝对路径与相对路径别名自动合并，避免重复统计；不同目录下同名文件自动显示父目录消歧。
3. **完全独立的命名空间与零冲突隔离**：
   - 采用独立的 `diffReviewLikecodex` Remote 远程服务与 `diff-review-likecodex` 设置/多语言空间；
   - 评论标记独立为 `<diff_review_likecodex_comments>`；
   - 公共 DSH slot 保留框架规范，不抢占共享的 `chatFileMentions` 服务，避免与其他插件冲突。
4. **长文本自动换行与真实上下文采集**：
   - 在插件配置中提供代码长行自动换行开关（Word Wrap）；
   - 新采集的差异保留修改前后各三行真实上下文，绝不伪造历史上下文。

## 怎么用

<p align="center">
  <strong>💬 Chat &nbsp;→&nbsp; ✨ Generate &nbsp;→&nbsp; 📄 Click a changed file &nbsp;→&nbsp; 🔍 Review</strong>
</p>

## 效果预览

### 审查面板与变更卡片

![preview](./assets/preview.png)

### 运行中浮窗小横条（紧凑审查条）

![compact review bar](./assets/compact-bar.png)

## 功能

1. 本插件支持标准模式、PTC 模式、创造模式，**暂时不支持极简模式**。
2. 可以通过 `Diff` 面板审查 Agent 刚刚修改的每个文件。
3. 支持撤销编辑文件、新增文件操作。撤销删除文件需要工具提供受支持且已捕获的生命周期变更。
4. 可对变更行添加评论，并让 Agent 根据评论内容继续修改，或者对该变更进行询问。
5. 审查时支持长文本自动换行，可在“设置 → 插件 → 插件配置 → Diff Review Likecodex”中开启，默认关闭。
6. 多语言支持，包括中文和英文。
7. 运行中在输入框上方显示按内容自适应宽度的紧凑审查条，结束或停止后消失；末尾卡片的文件列表始终展开。
8. 同一工作区文件的绝对/相对路径别名合并为一项，不重复统计；不同目录同名文件会显示目录以区分。
9. 新采集的差异保留修改前后各三行真实上下文；历史缺失上下文不会用当前文件伪造。
10. 从右侧栏打开审查页，并通过轮次选择器加载当前会话某一轮中全部已记录的文件编辑。安装 `dsh-better-sidebar@0.19.1` 后，也可从其新建页签菜单打开审查页；否则使用原生右侧栏页签。原生页签布局本身不保证跨重启持久化。

## 兼容性声明

当前适配的 DSH CLI 版本见顶部徽章。`dsh-better-sidebar` 为可选 peer dependency（`>=0.19.1 <0.20`），不会被浏览器硬注入；未接入时回退到原生侧栏。此外，运行中浮窗小横条与会话快速审查入口架构本身解耦清晰，亦可直接并入到 `bettersider` (`dsh-better-sidebar`) 项目中，实现更深度的一体化侧栏工作流协同。

## 从本地源码安装

在你已有的本 fork 源码目录中执行以下命令。由于尚不知道 fork 的仓库地址，这里不提供克隆 URL。安装与部署是独立操作；审查或构建源码本身不会安装插件。

```sh
pnpm install
pnpm run build
dsh plugin --profile web add ${PWD}
```

## 发布后通过包名安装

仅在你独立确认这个确切 fork 包已经发布后，使用：

```sh
dsh plugin --profile web add dsh-diff-review-likecodex
```

较新版 `pnpm` 可能限制最短发布时间。如有需要，在 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 中加入 fork 的确切包名：

```yaml
minimumReleaseAgeExclude:
  - dsh-diff-review-likecodex
```

## 更新插件

对于通过包名安装的实例，确认目标版本后执行：

```sh
dsh plugin --profile web update dsh-diff-review-likecodex
```

## 卸载插件

```sh
dsh plugin --profile web remove dsh-diff-review-likecodex
```

## 许可证

[MIT](LICENSE)。本 fork 在 `LICENSE` 中保留上游 MIT 许可及版权声明，不得删除该文件。上游来源署名与本 fork 的包身份相互独立。
