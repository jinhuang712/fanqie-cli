# skills

给 coding agent 用的 skill。`fanqie-cli/` 让 Claude Code 等 agent 识别并正确使用本 CLI（搜书、榜单、读章节）。

安装：用仓库根目录的 `install.sh` 一行安装（`curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash`）会同时装好全局命令 `fanqie` 和这个 skill，并自动替换路径。手动安装：把 `skills/fanqie-cli` 复制到 `~/.claude/skills/`，再把其中 `SKILL.md` 里的 `<仓库根目录>` 换成你克隆本仓库的路径。
