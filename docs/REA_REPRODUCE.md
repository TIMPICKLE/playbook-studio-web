# 重跑公开脚本的 REA 调查

目标是 Playmaker X 登录前页面公开加载的脚本。调查输入仅保存在临时目录，不提交目标源码或原始分析输出。工具版本固定为 REA 6.4.0。

## 前提

使用 REA 支持的 Node.js 版本（本次为 24.19.0），能够联网获取 npm 包与目标脚本，且 Linux 进程检查能够正确读取本进程和子进程。参考 [REA 官方说明](https://github.com/morluto/rea/blob/main/README_zh.md)。

## 命令

```bash
REA_TASK_DIR="$(mktemp -d)"
mkdir "$REA_TASK_DIR/input"
curl --fail --location \
  https://www.tacklefootballplaymaker.com/app/src/app.js \
  --output "$REA_TASK_DIR/input/app.js"
sha256sum "$REA_TASK_DIR/input/app.js"

npx --yes rea-agents@6.4.0 inspect-artifact \
  "$REA_TASK_DIR/input/app.js" --format json --full-output \
  > "$REA_TASK_DIR/artifact-evidence.json"

npx --yes rea-agents@6.4.0 analyze-javascript-application \
  "$REA_TASK_DIR/input" --artifact-format directory \
  --max-heap-mb 1536 --analysis-timeout-ms 180000 \
  --format json --full-output \
  > "$REA_TASK_DIR/application-evidence.json"
```

本次校验脚本的 SHA-256 为 `7860e5a05bcdd2932c6abba09d302dd762a1d69f2873e0dc5fd810e761ac131a`。后续产品更新会改变字节与证据，不能把本次标识用于新版文件。

读取实际返回的 Evidence 和 coverage。若 `isError` 为真，检查部分观察及限制；文件清单成功不意味着 JS 功能图已经成功。不要关闭或伪造工具的进程监督来消除错误。

本项目环境下文件检查成功，隔离源分析启动失败。补充 AST 观察使用 Babel parser 8.0.4，静态解析同一份脚本；未导入或执行目标代码。查看 [调查报告](PUBLIC_BUNDLE_STATIC_FINDINGS.md) 中的模块位置、事实编号和未验证事项。补充 AST 事实编号不是 REA Evidence ID。

## 原应用行为的后续验证

若将来提供已授权账号或自己导出的样本，可进一步比较真实路线编辑、动画时序、打印版式和文件格式。当前实现使用自有 JSON 格式，不能直接导入原版 Playmaker X 文件。
