# Security policy

English | [简体中文](#安全政策)

## Supported versions

Security fixes target the [latest stable release](https://github.com/ruishanio/adm/releases/latest). Older releases do not have a separate security maintenance branch. Development builds and prereleases are not supported release channels, but reports affecting them are welcome.

## Report a vulnerability privately

Use [Report a vulnerability](https://github.com/ruishanio/adm/security/advisories/new) in this repository's **Security and quality → Advisories** section. Do not disclose exploitable vulnerabilities in public issues or pull requests.

Include the affected ADM version, desktop OS, Android version and connection method when relevant, reproduction steps or a minimal proof of concept, expected security boundary, and observed impact. Remove passwords, pairing codes, tokens, private files, and identifying device data; use a test device you own or have permission to test.

If private reporting is unavailable, open an issue asking only for a private security contact, without vulnerability details or attachments.

Maintainers will assess the report and coordinate remediation and disclosure with the reporter. Response and fix times depend on impact and maintainer availability; no fixed response deadline or bounty is promised.

## Scope

Relevant reports include unintended command execution, access to host or device files, unsafe IPC input handling, incorrect authorization or device targeting, and compromised update or packaging resources. ADM's intended ADB operations require an authorized device; report ways to bypass a boundary or perform an operation without the expected authorization.

For problems in ADB, the Android scrcpy server, Tauri, or another dependency, identify the affected component and its impact on ADM. Maintainers may coordinate with upstream. Ordinary connection failures, feature requests, and reproducible UI bugs belong in [Issues](https://github.com/ruishanio/adm/issues/new/choose).

## 安全政策

### 支持范围

安全修复面向[最新稳定版](https://github.com/ruishanio/adm/releases/latest)，旧版本没有独立的安全维护分支。开发版本及预发布版不属于正式支持渠道，但欢迎反馈其中的安全问题。

### 私密反馈漏洞

请通过仓库 **Security and quality → Advisories** 中的 [Report a vulnerability](https://github.com/ruishanio/adm/security/advisories/new) 提交，不要在公开 Issue 或 PR 中披露可利用的漏洞。

请提供 ADM 版本、桌面系统，以及相关的 Android 版本和连接方式；说明复现步骤或最小验证样例、预期的安全边界及实际影响。移除密码、配对码、令牌、私人文件和可识别的设备数据，仅在自己拥有或获准测试的设备上验证。

如果私密反馈入口暂时不可用，可以新建 Issue 仅询问私密联系方式，不要包含漏洞细节或附件。

维护者会评估问题，并与报告者协商修复及公开披露。处理时间取决于影响程度和维护者的可用时间，不承诺固定响应期限或漏洞奖励。

### 问题分类

安全问题包括非预期命令执行、主机或设备文件越权访问、IPC 输入处理缺陷、授权或目标设备校验错误，以及更新或打包资源被篡改。ADM 的正常 ADB 操作以设备授权为前提；如果可以绕过安全边界或缺少预期授权就执行操作，请反馈。

涉及 ADB、Android scrcpy 服务端、Tauri 等依赖时，请说明具体组件及对 ADM 的影响，维护者可能与上游协作。普通连接故障、功能建议和界面问题请使用 [Issue 表单](https://github.com/ruishanio/adm/issues/new/choose)。
