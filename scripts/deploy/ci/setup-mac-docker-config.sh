#!/usr/bin/env bash

set -euo pipefail

# Prepare a self-contained Docker CLI config for the self-hosted Mac Studio
# runner so `docker compose` (via pnpm infra:ensure) reaches the daemon and
# finds the compose/buildx plugins without depending on the interactive
# login shell's environment or a credential helper.
#
# The GitHub Actions runner process does not inherit the login shell's
# DOCKER_HOST / docker context, and a stray credential-helper entry in the
# host ~/.docker/config.json can make `docker compose` prompt or fail. This
# points DOCKER_CONFIG at an isolated dir with an empty config.json, links the
# compose + buildx plugins into it, and preserves the resolved DOCKER_HOST.

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

docker_config="${RUNNER_TEMP}/docker-config"
mkdir -p "$docker_config"
chmod 700 "$docker_config"

preserve_current_docker_host() {
  if [[ -n "${DOCKER_HOST:-}" ]]; then
    printf 'DOCKER_HOST=%s\n' "$DOCKER_HOST" >> "$GITHUB_ENV"
    return
  fi

  local docker_context docker_host
  docker_context="$(docker context show 2>/dev/null || true)"
  if [[ -z "$docker_context" ]]; then
    return
  fi

  docker_host="$(docker context inspect "$docker_context" --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
  if [[ -z "$docker_host" || "$docker_host" == "<no value>" ]]; then
    return
  fi

  export DOCKER_HOST="$docker_host"
  printf 'DOCKER_HOST=%s\n' "$docker_host" >> "$GITHUB_ENV"
}

link_docker_cli_plugin() {
  local plugin_name="$1"
  local plugin_path=""

  for candidate in \
    "${HOME:-}/.docker/cli-plugins/${plugin_name}" \
    "/Applications/Docker.app/Contents/Resources/cli-plugins/${plugin_name}" \
    "/opt/homebrew/lib/docker/cli-plugins/${plugin_name}" \
    "/usr/local/lib/docker/cli-plugins/${plugin_name}"
  do
    if [[ -x "$candidate" ]]; then
      plugin_path="$candidate"
      break
    fi
  done

  if [[ -z "$plugin_path" ]]; then
    echo "Warning: Docker CLI plugin not found: ${plugin_name}" >&2
    return 0
  fi

  mkdir -p "${docker_config}/cli-plugins"
  ln -sf "$plugin_path" "${docker_config}/cli-plugins/${plugin_name}"
}

link_docker_cli_plugin docker-buildx
link_docker_cli_plugin docker-compose

preserve_current_docker_host

printf '{}\n' > "${docker_config}/config.json"
chmod 600 "${docker_config}/config.json"

printf 'DOCKER_CONFIG=%s\n' "$docker_config" >> "$GITHUB_ENV"

echo "Docker config prepared without credential helpers at ${docker_config}."
