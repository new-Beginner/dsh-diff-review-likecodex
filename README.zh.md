<div align="center">

# DSH Diff Review Likecodex

**无需离开 DeepSeek Harness Web，即可立即审查 Agent 刚刚修改的每个文件。**

[![Adapted DSH CLI version](https://img.shields.io/badge/DSH_CLI-0.1.5--rc.1-4f46e5?style=flat-square)](package.json)
![Web profile](https://img.shields.io/badge/profile-Web-0ea5e9?style=flat-square)
[![MIT License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)

[English](README.md) · 简体中文

</div>

## 仓库与命名空间

`dsh-diff-review-likecodex` 是托管于 [new-Beginner/dsh-diff-review-likecodex](https://github.com/new-Beginner/dsh-diff-review-likecodex) 的独立插件。

本项目使用独立的 `diffReviewLikecodex` remote/service 命名空间、`diff-review-likecodex` settings/locale 命名空间、`dshDiffReviewLikecodex` 标记属性和 `diff-review-likecodex.deliverables` 轮次数据键。自有 UI/插件注册 ID 使用 `dsh-diff-review-likecodex:` 前缀。公共 DSH slot 保留框架原名；本项目不注册共享的 `chatFileMentions` 服务，避免与其他插件冲突。

历史兼容标记仅作为只读兼容数据，且只在不存在本项目标记时读取。Host 不会将旧标记当作自己的数据，也不会删除或重写它们。新评论使用 `<diff_review_likecodex_comments>`；历史 `<file_review_comments>` 消息仍可显示，但不会写入旧服务或设置。Cordis patch 只插入本项目，不再禁用 DSH 内置 deliverables 插件。

## 怎么用

<p align="center">
  <strong>💬 Chat &nbsp;→&nbsp; ✨ Generate &nbsp;→&nbsp; 📄 Click a changed file &nbsp;→&nbsp; 🔍 Review</strong>
</p>

## 效果预览

![preview](./assets/preview.png)

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

当前适配的 DSH CLI 版本见顶部徽章。`dsh-better-sidebar` 为可选 peer dependency（`>=0.19.1 <0.20`），不会被浏览器硬注入；未接入时回退到原生侧栏。

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

## 友情链接

[LINUX DO](https://linux.do/) — 新的理想型社区

## 许可证

[MIT](LICENSE)。本 fork 在 `LICENSE` 中保留上游 MIT 许可及版权声明，不得删除该文件。上游来源署名与本 fork 的包身份相互独立。
