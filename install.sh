#!/usr/bin/env bash

if (return 0 2>/dev/null); then
  CODEX_WORKER_INSTALL_SOURCED=1
else
  CODEX_WORKER_INSTALL_SOURCED=0
fi

if [[ "${CODEX_WORKER_INSTALL_SOURCED}" -eq 0 ]]; then
  set -euo pipefail
fi

CODEX_WORKER_DEFAULT_REPO="yigitkonur/codex-worker"
CODEX_WORKER_DEFAULT_BIN_NAME="codex-worker"
CODEX_WORKER_DEFAULT_INSTALL_DIR="/usr/local/bin"
CODEX_WORKER_DEFAULT_USER_INSTALL_DIR="${HOME:-$PWD}/.local/bin"

cw_log() {
  printf '%s\n' "$*" >&2
}

cw_warn() {
  printf 'warning: %s\n' "$*" >&2
}

cw_die() {
  printf 'error: %s\n' "$*" >&2
  return 1
}

cw_current_uid() {
  if [[ -n "${CW_TEST_UID:-}" ]]; then
    printf '%s\n' "${CW_TEST_UID}"
    return 0
  fi

  id -u
}

cw_normalize_version() {
  local version="${1:-latest}"

  if [[ -z "${version}" || "${version}" == "latest" ]]; then
    printf 'latest\n'
    return 0
  fi

  if [[ "${version}" == v* ]]; then
    printf '%s\n' "${version}"
  else
    printf 'v%s\n' "${version}"
  fi
}

cw_version_without_prefix() {
  local version
  version="$(cw_normalize_version "${1:-latest}")"
  printf '%s\n' "${version#v}"
}

cw_release_download_url() {
  local repo="${1:?repo required}"
  local version="${2:?version required}"
  local asset="${3:?asset required}"

  if [[ -n "${CODEX_WORKER_DOWNLOAD_BASE_URL:-}" ]]; then
    printf '%s/%s/%s\n' "${CODEX_WORKER_DOWNLOAD_BASE_URL%/}" "${version}" "${asset}"
    return 0
  fi

  if [[ "${version}" == "latest" ]]; then
    printf 'https://github.com/%s/releases/latest/download/%s\n' "${repo}" "${asset}"
  else
    printf 'https://github.com/%s/releases/download/%s/%s\n' "${repo}" "${version}" "${asset}"
  fi
}

cw_normalize_os() {
  local raw="${1:?os required}"

  case "${raw}" in
    Linux|linux)
      printf 'Linux\n'
      ;;
    Darwin|darwin)
      printf 'Darwin\n'
      ;;
    *)
      cw_die "unsupported operating system: ${raw}"
      ;;
  esac
}

cw_normalize_arch() {
  local raw="${1:?arch required}"

  case "${raw}" in
    x86_64|amd64)
      printf 'x64\n'
      ;;
    arm64|aarch64)
      printf 'arm64\n'
      ;;
    *)
      cw_die "unsupported architecture: ${raw}"
      ;;
  esac
}

cw_libc_from_ldd_output() {
  local output="${1:-}"

  if printf '%s' "${output}" | grep -qi 'musl'; then
    printf 'musl\n'
    return 0
  fi

  if printf '%s' "${output}" | grep -qi 'glibc\|gnu libc'; then
    printf 'glibc\n'
    return 0
  fi

  printf 'unknown\n'
}

cw_detect_libc() {
  if [[ -n "${CODEX_WORKER_INSTALL_LIBC:-}" ]]; then
    printf '%s\n' "${CODEX_WORKER_INSTALL_LIBC}"
    return 0
  fi

  if [[ "$(cw_normalize_os "${CODEX_WORKER_INSTALL_OS:-$(uname -s)}")" != "Linux" ]]; then
    printf 'none\n'
    return 0
  fi

  if [[ -r "/etc/alpine-release" ]] || ls /lib/ld-musl-*.so.1 >/dev/null 2>&1; then
    printf 'musl\n'
    return 0
  fi

  if command -v getconf >/dev/null 2>&1 && getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
    printf 'glibc\n'
    return 0
  fi

  if command -v ldd >/dev/null 2>&1; then
    local detected
    detected="$(cw_libc_from_ldd_output "$(ldd --version 2>&1 || true)")"
    if [[ "${detected}" != "unknown" ]]; then
      printf '%s\n' "${detected}"
      return 0
    fi
  fi

  cw_warn 'could not confidently detect libc; defaulting to glibc'
  printf 'glibc\n'
}

cw_cpu_needs_baseline() {
  local features="${1:-}"

  if printf '%s\n' "${features}" | grep -qi 'avx2'; then
    return 1
  fi
  return 0
}

cw_detect_cpu_features() {
  if [[ -n "${CODEX_WORKER_INSTALL_CPU_FEATURES:-}" ]]; then
    printf '%s\n' "${CODEX_WORKER_INSTALL_CPU_FEATURES}"
    return 0
  fi

  local os arch
  os="$(cw_normalize_os "${CODEX_WORKER_INSTALL_OS:-$(uname -s)}")"
  arch="$(cw_normalize_arch "${CODEX_WORKER_INSTALL_ARCH:-$(uname -m)}")"

  if [[ "${arch}" != "x64" ]]; then
    printf '\n'
    return 0
  fi

  if [[ "${os}" == "Linux" && -r "/proc/cpuinfo" ]]; then
    grep -im1 '^flags' /proc/cpuinfo | cut -d: -f2-
    return 0
  fi

  if [[ "${os}" == "Darwin" ]] && command -v sysctl >/dev/null 2>&1; then
    (
      sysctl -n machdep.cpu.features 2>/dev/null
      printf ' '
      sysctl -n machdep.cpu.leaf7_features 2>/dev/null
    ) | tr '\n' ' '
    return 0
  fi

  printf '\n'
}

cw_detect_baseline_required() {
  local os arch libc features
  os="$(cw_normalize_os "${CODEX_WORKER_INSTALL_OS:-$(uname -s)}")"
  arch="$(cw_normalize_arch "${CODEX_WORKER_INSTALL_ARCH:-$(uname -m)}")"
  libc="$(cw_detect_libc)"

  if [[ "${os}" != "Linux" || "${arch}" != "x64" ]]; then
    return 1
  fi

  if [[ "${libc}" == "musl" ]]; then
    return 1
  fi

  features="$(cw_detect_cpu_features)"
  cw_cpu_needs_baseline "${features}"
}

cw_select_asset_name() {
  local os="${1:?os required}"
  local arch="${2:?arch required}"
  local libc="${3:?libc required}"
  local needs_baseline="${4:?baseline flag required}"

  case "${os}:${arch}" in
    Darwin:x64)
      printf 'codex-worker-darwin-x64\n'
      ;;
    Darwin:arm64)
      printf 'codex-worker-darwin-arm64\n'
      ;;
    Linux:arm64)
      if [[ "${libc}" == "musl" ]]; then
        printf 'codex-worker-linux-arm64-musl\n'
      else
        printf 'codex-worker-linux-arm64\n'
      fi
      ;;
    Linux:x64)
      if [[ "${libc}" == "musl" ]]; then
        if [[ "${needs_baseline}" == "true" ]]; then
          cw_die 'no musl baseline release asset is published for linux x64; use a glibc system or build from source'
          return 1
        fi
        printf 'codex-worker-linux-x64-musl\n'
      elif [[ "${needs_baseline}" == "true" ]]; then
        printf 'codex-worker-linux-x64-baseline\n'
      else
        printf 'codex-worker-linux-x64\n'
      fi
      ;;
    *)
      cw_die "unsupported target combination: ${os}/${arch}"
      ;;
  esac
}

cw_compute_sha256() {
  local file="${1:?file required}"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file}" | awk '{print $1}'
    return 0
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file}" | awk '{print $1}'
    return 0
  fi

  cw_die 'neither sha256sum nor shasum is available for checksum verification'
}

cw_verify_sha256_file() {
  local binary_path="${1:?binary required}"
  local checksum_path="${2:?checksum file required}"
  local expected actual

  expected="$(awk 'NF { print $1; exit }' "${checksum_path}")"
  if [[ ! "${expected}" =~ ^[a-fA-F0-9]{64}$ ]]; then
    cw_die "checksum file did not contain a valid sha256 digest: ${checksum_path}"
    return 1
  fi

  actual="$(cw_compute_sha256 "${binary_path}")"
  if [[ "${actual}" != "${expected}" ]]; then
    cw_die "checksum verification failed for ${binary_path}"
    return 1
  fi
}

cw_resolve_install_dir() {
  if [[ -n "${CODEX_WORKER_INSTALL_DIR:-}" ]]; then
    printf '%s\n' "${CODEX_WORKER_INSTALL_DIR}"
    return 0
  fi

  if [[ "$(cw_current_uid)" == "0" ]]; then
    printf '%s\n' "${CODEX_WORKER_DEFAULT_INSTALL_DIR}"
    return 0
  fi

  if [[ -w "${CODEX_WORKER_DEFAULT_INSTALL_DIR}" ]]; then
    printf '%s\n' "${CODEX_WORKER_DEFAULT_INSTALL_DIR}"
    return 0
  fi

  printf '%s\n' "${CODEX_WORKER_DEFAULT_USER_INSTALL_DIR}"
}

cw_api_request() {
  local url="${1:?url required}"
  local -a curl_args
  curl_args=(-fsSL --retry 3 --connect-timeout 10)

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  curl_args+=(-H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "${url}")
  curl "${curl_args[@]}"
}

cw_fetch_latest_tag() {
  local repo="${1:?repo required}"
  local response tag

  if [[ -n "${CODEX_WORKER_INSTALL_LATEST_TAG:-}" ]]; then
    printf '%s\n' "$(cw_normalize_version "${CODEX_WORKER_INSTALL_LATEST_TAG}")"
    return 0
  fi

  response="$(cw_api_request "https://api.github.com/repos/${repo}/releases/latest")"
  tag="$(
    printf '%s' "${response}" \
      | tr -d '\n' \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
  )"

  if [[ -z "${tag}" ]]; then
    cw_die "could not parse latest release tag from GitHub API for ${repo}"
    return 1
  fi

  printf '%s\n' "${tag}"
}

cw_installed_version() {
  local installed_path="${1:?installed path required}"
  if [[ ! -x "${installed_path}" ]]; then
    return 1
  fi

  "${installed_path}" --version 2>/dev/null | awk 'NF { print $NF; exit }'
}

cw_download_file() {
  local url="${1:?url required}"
  local output_path="${2:?output path required}"
  local -a curl_args
  curl_args=(-fsSL --retry 3 --connect-timeout 10 -o "${output_path}")

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  curl_args+=("${url}")
  curl "${curl_args[@]}"
}

cw_usage() {
  cat <<'EOF'
Usage:
  curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | sudo bash

Options:
  --version <version>       Install a specific release tag or version number
  --install-dir <dir>       Install directory (default: /usr/local/bin as root, otherwise ~/.local/bin)
  --target <asset-name>     Override auto-detected release asset name
  --repo <owner/repo>       GitHub repository to install from
  --force                   Reinstall even if the same version is already installed
  --no-verify               Skip sha256 verification
  --dry-run                 Print the resolved install plan without downloading
  --help                    Show this help text

Environment overrides:
  CODEX_WORKER_INSTALL_DIR
  CODEX_WORKER_INSTALL_OS
  CODEX_WORKER_INSTALL_ARCH
  CODEX_WORKER_INSTALL_LIBC
  CODEX_WORKER_INSTALL_CPU_FEATURES
  GITHUB_TOKEN
EOF
}

cw_main() {
  local repo="${CODEX_WORKER_INSTALL_REPO:-${CODEX_WORKER_DEFAULT_REPO}}"
  local requested_version="latest"
  local explicit_target=""
  local install_dir=""
  local verify_checksums="true"
  local force_install="false"
  local dry_run="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        requested_version="${2:?missing value for --version}"
        shift 2
        ;;
      --install-dir)
        install_dir="${2:?missing value for --install-dir}"
        shift 2
        ;;
      --target)
        explicit_target="${2:?missing value for --target}"
        shift 2
        ;;
      --repo)
        repo="${2:?missing value for --repo}"
        shift 2
        ;;
      --force)
        force_install="true"
        shift
        ;;
      --no-verify)
        verify_checksums="false"
        shift
        ;;
      --dry-run)
        dry_run="true"
        shift
        ;;
      --help|-h)
        cw_usage
        return 0
        ;;
      *)
        cw_die "unknown argument: $1"
        return 1
        ;;
    esac
  done

  if [[ -n "${install_dir}" ]]; then
    CODEX_WORKER_INSTALL_DIR="${install_dir}"
  fi

  local os arch libc baseline asset_name version_tag resolved_version install_path checksum_name
  os="$(cw_normalize_os "${CODEX_WORKER_INSTALL_OS:-$(uname -s)}")"
  arch="$(cw_normalize_arch "${CODEX_WORKER_INSTALL_ARCH:-$(uname -m)}")"
  libc="$(cw_detect_libc)"
  baseline="false"
  if cw_detect_baseline_required; then
    baseline="true"
  fi

  if [[ -n "${explicit_target}" ]]; then
    asset_name="${explicit_target}"
  else
    asset_name="$(cw_select_asset_name "${os}" "${arch}" "${libc}" "${baseline}")"
  fi

  version_tag="$(cw_normalize_version "${requested_version}")"
  if [[ "${version_tag}" == "latest" ]]; then
    resolved_version="$(cw_fetch_latest_tag "${repo}")"
  else
    resolved_version="${version_tag}"
  fi

  install_dir="$(cw_resolve_install_dir)"
  install_path="${install_dir}/${CODEX_WORKER_DEFAULT_BIN_NAME}"
  checksum_name="${asset_name}.sha256"

  if [[ "${dry_run}" == "true" ]]; then
    cat <<EOF
repo=${repo}
version=${resolved_version}
os=${os}
arch=${arch}
libc=${libc}
baseline=${baseline}
asset=${asset_name}
checksum=${checksum_name}
install_dir=${install_dir}
install_path=${install_path}
EOF
    return 0
  fi

  mkdir -p "${install_dir}"

  local installed_version
  installed_version="$(cw_installed_version "${install_path}" || true)"
  if [[ "${force_install}" != "true" && -n "${installed_version}" && "${installed_version}" == "$(cw_version_without_prefix "${resolved_version}")" ]]; then
    cw_log "codex-worker ${installed_version} is already installed at ${install_path}"
    return 0
  fi

  local temp_dir binary_temp checksum_temp
  temp_dir="$(mktemp -d)"
  binary_temp="${temp_dir}/${asset_name}"
  checksum_temp="${temp_dir}/${checksum_name}"
  trap 'if [[ -n "${temp_dir:-}" ]]; then rm -rf "${temp_dir}"; fi' EXIT

  cw_log "Downloading ${asset_name} (${resolved_version}) from ${repo}"
  cw_download_file "$(cw_release_download_url "${repo}" "${resolved_version}" "${asset_name}")" "${binary_temp}"

  if [[ "${verify_checksums}" == "true" ]]; then
    cw_log "Verifying checksum"
    cw_download_file "$(cw_release_download_url "${repo}" "${resolved_version}" "${checksum_name}")" "${checksum_temp}"
    cw_verify_sha256_file "${binary_temp}" "${checksum_temp}"
  fi

  chmod 0755 "${binary_temp}"

  if command -v install >/dev/null 2>&1; then
    install -m 0755 "${binary_temp}" "${install_path}"
  else
    cp "${binary_temp}" "${install_path}"
    chmod 0755 "${install_path}"
  fi

  cw_log "Installed ${CODEX_WORKER_DEFAULT_BIN_NAME} ${resolved_version#v} to ${install_path}"

  if ! command -v codex >/dev/null 2>&1; then
    cw_warn 'codex CLI is not installed or not on PATH; codex-worker requires codex to be installed and authenticated'
  fi

  if [[ "$(cw_current_uid)" != "0" && ":${PATH}:" != *":${install_dir}:"* ]]; then
    cw_warn "${install_dir} is not currently on PATH"
  fi

  # Post-install: detect shadowed or stale codex-worker binaries elsewhere on PATH
  local active_path
  active_path="$(command -v "${CODEX_WORKER_DEFAULT_BIN_NAME}" 2>/dev/null || true)"
  if [[ -n "${active_path}" && "${active_path}" != "${install_path}" ]]; then
    local active_version
    active_version="$("${active_path}" --version 2>/dev/null || true)"
    cw_warn "another codex-worker (${active_version:-unknown version}) exists at ${active_path} and takes precedence over ${install_path}"
    cw_warn "remove it with: rm \"${active_path}\" (or npm uninstall -g codex-worker)"
  fi

  # Detect all other codex-worker binaries on PATH that could cause confusion
  local IFS=':'
  local dir_entry found_path
  for dir_entry in ${PATH}; do
    found_path="${dir_entry:-.}/${CODEX_WORKER_DEFAULT_BIN_NAME}"
    if [[ -x "${found_path}" && "${found_path}" != "${install_path}" && "${found_path}" != "${active_path:-}" ]]; then
      local stale_version
      stale_version="$("${found_path}" --version 2>/dev/null || true)"
      cw_warn "stale codex-worker (${stale_version:-unknown version}) found at ${found_path}"
    fi
  done
}

if [[ "${CODEX_WORKER_INSTALL_SOURCED}" -eq 0 ]]; then
  cw_main "$@"
fi
