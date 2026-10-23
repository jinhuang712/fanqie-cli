#!/usr/bin/env bash
# fanqie-cli 一行安装脚本：安装命令行（全局 fanqie 命令）和 Claude Code skill。
#   curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash
# 不用 sudo，不改 shell 配置文件。再运行一次就是升级。
#
# 整个逻辑都在函数里，最后一行才调用 main：curl | bash 下载到一半时不会执行半截脚本。
set -euo pipefail

main() {
  local REPO="jinhuang712/fanqie-cli"
  local PLACEHOLDER="<仓库根目录>"
  local WRAPPER_MARK="# fanqie-cli-wrapper"

  local home_dir="${HOME:-}"
  local install_dir="${FANQIE_HOME:-$home_dir/.local/share/fanqie-cli}"
  local bin_dir="${FANQIE_BIN:-$home_dir/.local/bin}"
  local skills_dir="${CLAUDE_SKILLS_DIR:-$home_dir/.claude/skills}"
  local version="main"
  local want_skill=1
  local do_uninstall=0
  local do_install_bun=0
  local print_url=0

  # 临时目录：退出时统一清理，失败不留半截
  TMP_PATHS=()
  cleanup() {
    local p
    # bash 3.2 下空数组配合 set -u 会报错，所以先判断长度
    if [ "${#TMP_PATHS[@]}" -gt 0 ]; then
      for p in "${TMP_PATHS[@]}"; do
        [ -n "$p" ] && rm -rf "$p"
      done
    fi
  }
  trap cleanup EXIT

  die() {
    printf '错误：%s\n' "$1" >&2
    if [ -n "${2:-}" ]; then printf '下一步：%s\n' "$2" >&2; fi
    exit 1
  }
  info() { printf '%s\n' "$*"; }

  usage() {
    cat <<'EOF'
fanqie-cli 安装脚本

用法：
  curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/jinhuang712/fanqie-cli/main/install.sh | bash -s -- [参数]
  bash install.sh [参数]

参数：
  --version <版本>   安装指定的 tag（默认 main，即最新代码）
  --no-skill         只装命令行，不装 Claude Code skill
  --install-bun      没有 bun 时，同意由本脚本用官方脚本安装 bun
  --uninstall        卸载：删除安装目录、fanqie 命令和 skill
                     （不删缓存和登录态，命令结束时会告诉你位置）
  -h, --help         显示这段帮助

环境变量：
  FANQIE_HOME        安装目录，默认 ~/.local/share/fanqie-cli
  FANQIE_BIN         fanqie 命令所在目录，默认 ~/.local/bin
  CLAUDE_SKILLS_DIR  skill 目录，默认 ~/.claude/skills

再运行一次同样的命令就是升级。不使用 sudo，不修改 .zshrc、.bashrc 等配置文件。
EOF
  }

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        [ "$#" -ge 2 ] || die "--version 后面要跟版本号。" "例如 --version v0.1.0"
        version="$2"
        shift 2
        ;;
      --version=*) version="${1#--version=}"; shift ;;
      --no-skill) want_skill=0; shift ;;
      --install-bun) do_install_bun=1; shift ;;
      --uninstall) do_uninstall=1; shift ;;
      --print-url) print_url=1; shift ;;
      -h | --help) usage; return 0 ;;
      *) usage >&2; die "不认识的参数：$1" "看上面的用法，或加 --help。" ;;
    esac
  done

  [ -n "$home_dir" ] || [ -n "${FANQIE_HOME:-}" ] || die "环境变量 HOME 没有设置。" "设置 HOME，或同时设置 FANQIE_HOME、FANQIE_BIN、CLAUDE_SKILLS_DIR。"

  case "$version" in
    "" | *[!A-Za-z0-9._-]*) die "版本号只能包含字母、数字、点、下划线和连字符：$version" ;;
  esac

  local archive_url
  if [ "$version" = "main" ]; then
    archive_url="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
  else
    archive_url="https://github.com/$REPO/archive/refs/tags/$version.tar.gz"
  fi
  if [ "$print_url" -eq 1 ]; then
    info "$archive_url"
    return 0
  fi

  local wrapper="$bin_dir/fanqie"
  local skill_target="$skills_dir/fanqie-cli"

  # ---------- 卸载 ----------
  if [ "$do_uninstall" -eq 1 ]; then
    info "卸载 fanqie-cli ..."
    if [ -d "$install_dir" ]; then
      rm -rf "$install_dir"
      info "  已删除安装目录：$install_dir"
    else
      info "  安装目录不存在，跳过：$install_dir"
    fi
    if [ -f "$wrapper" ]; then
      if grep -q "$WRAPPER_MARK" "$wrapper" 2>/dev/null; then
        rm -f "$wrapper"
        info "  已删除命令：$wrapper"
      else
        info "  $wrapper 不是本脚本生成的，没有删除。"
      fi
    else
      info "  命令不存在，跳过：$wrapper"
    fi
    if [ -d "$skill_target" ]; then
      rm -rf "$skill_target"
      info "  已删除 skill：$skill_target"
    else
      info "  skill 不存在，跳过：$skill_target"
    fi
    info ""
    info "没有删除缓存和登录态（里面有已缓存的章节、字体和你的登录信息）："
    info "  缓存：${XDG_CACHE_HOME:-$home_dir/.cache}/fanqie-cli"
    info "  登录态：${XDG_CONFIG_HOME:-$home_dir/.config}/fanqie-cli"
    info "想清掉它们：rm -rf '${XDG_CACHE_HOME:-$home_dir/.cache}/fanqie-cli' '${XDG_CONFIG_HOME:-$home_dir/.config}/fanqie-cli'"
    return 0
  fi

  # ---------- 前置检查 ----------
  command -v tar >/dev/null 2>&1 || die "找不到 tar。" "先安装 tar 再重新运行。"
  if [ -z "${FANQIE_INSTALL_SOURCE:-}" ]; then
    command -v curl >/dev/null 2>&1 || die "找不到 curl。" "先安装 curl 再重新运行。"
  fi

  bun_ok() {
    local v major minor
    command -v bun >/dev/null 2>&1 || return 1
    v="$(bun --version 2>/dev/null)" || return 1
    major="${v%%.*}"
    minor="${v#*.}"
    minor="${minor%%.*}"
    case "$major$minor" in "" | *[!0-9]*) return 1 ;; esac
    [ "$major" -gt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -ge 4 ]; }
  }

  if ! command -v bun >/dev/null 2>&1; then
    if [ "$do_install_bun" -eq 1 ]; then
      command -v curl >/dev/null 2>&1 || die "找不到 curl，没法安装 bun。"
      info "按你的要求安装 bun（官方脚本 https://bun.sh/install）..."
      curl -fsSL https://bun.sh/install | bash || die "bun 安装失败。" "手动安装 bun 后重新运行。"
      export PATH="${BUN_INSTALL:-$home_dir/.bun}/bin:$PATH"
    else
      {
        echo "错误：没有找到 bun。fanqie-cli 需要 bun 1.4 或更新版本。"
        echo "下一步：先安装 bun，再重新运行本命令："
        echo "  curl -fsSL https://bun.sh/install | bash"
        echo "或者加上 --install-bun，同意本脚本替你安装 bun。"
      } >&2
      exit 1
    fi
  fi
  bun_ok || die "bun 版本太旧：$(bun --version 2>/dev/null || echo 未知)，需要 1.4 或更新。" "运行 bun upgrade 后重新运行本命令。"

  # ---------- 准备新目录（和安装目录同一个父目录，保证最后是原子替换） ----------
  mkdir -p "$(dirname "$install_dir")" "$bin_dir"
  local stage old=""
  stage="$(mktemp -d "$(dirname "$install_dir")/.fanqie-cli-new.XXXXXX")" || die "没法在 $(dirname "$install_dir") 里创建临时目录。" "检查目录权限，或用 FANQIE_HOME 换一个位置。"
  TMP_PATHS+=("$stage")

  if [ -n "${FANQIE_INSTALL_SOURCE:-}" ]; then
    [ -d "$FANQIE_INSTALL_SOURCE" ] || die "FANQIE_INSTALL_SOURCE 不是目录：$FANQIE_INSTALL_SOURCE"
    info "从本地目录复制代码：$FANQIE_INSTALL_SOURCE"
    tar -C "$FANQIE_INSTALL_SOURCE" --exclude=.git --exclude=node_modules -cf - . | tar -C "$stage" -xf - \
      || die "复制本地代码失败。"
  else
    info "下载 $archive_url"
    local dl
    dl="$(mktemp -d "${TMPDIR:-/tmp}/fanqie-dl.XXXXXX")" || die "没法创建临时目录。"
    TMP_PATHS+=("$dl")
    curl -fsSL "$archive_url" -o "$dl/src.tar.gz" \
      || die "下载失败：$archive_url" "检查网络；如果指定了 --version，确认这个 tag 存在。"
    tar -xzf "$dl/src.tar.gz" -C "$stage" --strip-components=1 \
      || die "解压失败，下载的文件可能不完整。" "重新运行一次。"
  fi
  if [ ! -f "$stage/src/cli.ts" ] || [ ! -f "$stage/package.json" ]; then
    die "代码目录里没有 src/cli.ts 或 package.json，来源不对。"
  fi

  # ---------- 依赖 ----------
  if [ "${FANQIE_SKIP_DEPS:-}" = "1" ]; then
    # 测试用：不联网，有源码的 node_modules 就软链过来
    if [ -n "${FANQIE_INSTALL_SOURCE:-}" ] && [ -d "$FANQIE_INSTALL_SOURCE/node_modules" ]; then
      ln -s "$FANQIE_INSTALL_SOURCE/node_modules" "$stage/node_modules"
    fi
  else
    info "安装依赖（bun install --production）..."
    (cd "$stage" && bun install --production --frozen-lockfile) \
      || die "安装依赖失败，旧的安装没有被改动。" "检查网络后重新运行。"
  fi

  # ---------- 替换安装目录（失败能回滚） ----------
  if [ -e "$install_dir" ]; then
    old="$install_dir.old.$$"
    mv "$install_dir" "$old" || die "没法替换旧的安装目录：$install_dir"
    TMP_PATHS+=("$old")
  fi
  if ! mv "$stage" "$install_dir"; then
    if [ -n "$old" ]; then mv "$old" "$install_dir" || true; fi
    die "没法把新版本放到 ${install_dir}，已尝试恢复旧版本。"
  fi
  chmod 755 "$install_dir"

  # ---------- 全局命令 ----------
  local wtmp q_dir
  wtmp="$(mktemp "$bin_dir/.fanqie.XXXXXX")" || die "没法在 $bin_dir 里创建文件。" "检查目录权限，或用 FANQIE_BIN 换一个位置。"
  TMP_PATHS+=("$wtmp")
  printf -v q_dir '%q' "$install_dir"
  # shellcheck disable=SC2016  # 下面是要原样写进包装脚本的文本，不在这里展开
  {
    echo '#!/usr/bin/env bash'
    echo "${WRAPPER_MARK}：由 install.sh 生成，--uninstall 会删除它"
    echo 'if ! command -v bun >/dev/null 2>&1; then'
    echo '  if [ -x "${BUN_INSTALL:-$HOME/.bun}/bin/bun" ]; then'
    echo '    PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"'
    echo '  else'
    echo '    echo "fanqie：找不到 bun。请先安装：curl -fsSL https://bun.sh/install | bash" >&2'
    echo '    exit 127'
    echo '  fi'
    echo 'fi'
    echo "exec bun $q_dir/src/cli.ts \"\$@\""
  } >"$wtmp"
  chmod 755 "$wtmp"
  mv -f "$wtmp" "$wrapper"

  # ---------- skill ----------
  local skill_done=0
  if [ "$want_skill" -eq 1 ]; then
    if [ -d "$install_dir/skills/fanqie-cli" ]; then
      mkdir -p "$skills_dir"
      local sstage esc
      sstage="$(mktemp -d "$skills_dir/.fanqie-cli-new.XXXXXX")" || die "没法在 $skills_dir 里创建目录。" "检查权限，或用 CLAUDE_SKILLS_DIR 换一个位置；只想装命令行可加 --no-skill。"
      TMP_PATHS+=("$sstage")
      cp -R "$install_dir/skills/fanqie-cli/." "$sstage/"
      # 替换里的 \ & | 要转义，免得路径里有这些字符时 sed 出错
      esc="$(printf '%s' "$install_dir" | sed -e 's/[\\&|]/\\&/g')"
      if [ -f "$sstage/SKILL.md" ]; then
        sed -e "s|$PLACEHOLDER|$esc|g" "$sstage/SKILL.md" >"$sstage/SKILL.md.new"
        mv "$sstage/SKILL.md.new" "$sstage/SKILL.md"
      fi
      rm -rf "$skill_target"
      mv "$sstage" "$skill_target"
      chmod 755 "$skill_target"
      skill_done=1
    else
      info "警告：这个版本里没有 skills/fanqie-cli，跳过 skill。"
    fi
  fi

  # ---------- 自检 ----------
  if ! "$wrapper" --help >/dev/null 2>&1; then
    die "安装完成但自检失败：$wrapper --help 没有正常退出。" "手动运行 '$wrapper --help' 看报错；卸载用 --uninstall。"
  fi

  local pkg_version source_label="$version"
  [ -z "${FANQIE_INSTALL_SOURCE:-}" ] || source_label="本地目录"
  pkg_version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$install_dir/package.json" | head -1)"

  info ""
  info "安装完成。"
  info "  安装位置：$install_dir"
  info "  版本：${pkg_version:-未知}（来源：${source_label}）"
  info "  命令：$wrapper"
  if [ "$skill_done" -eq 1 ]; then
    info "  skill：$skill_target"
  else
    info "  skill：未安装"
  fi
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
      info ""
      info "提示：$bin_dir 不在你的 PATH 里，直接敲 fanqie 会找不到。"
      info "本脚本不改你的 shell 配置文件，请自己加上这一行（zsh 加到 ~/.zshrc，bash 加到 ~/.bashrc）："
      info "  export PATH=\"$bin_dir:\$PATH\""
      ;;
  esac
  info ""
  info "试试：fanqie search 修仙"
  info "升级：重新运行同一条安装命令；卸载：加 --uninstall。"
}

main "$@"
