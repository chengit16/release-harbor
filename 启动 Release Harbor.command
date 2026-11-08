#!/bin/zsh
# 双击启动本机工作台；只补充常用工具路径，不安装软件或修改系统设置。
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/share/pnpm:$PATH"
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '未找到 Node.js，请先安装 Node.js 24，再重新双击启动。'
  read '?按回车关闭窗口…'
  exit 1
fi
node scripts/launch.mjs
result=$?
if (( result != 0 )); then
  read '?启动未完成，请查看上方提示。按回车关闭窗口…'
fi
exit $result
