#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <images-env-file>"
  exit 1
fi

artifact_file="$1"
if [[ ! -f "$artifact_file" ]]; then
  echo "Artifact file not found: $artifact_file"
  exit 1
fi

api_image=""
worker_image=""

while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
  line="${raw_line#"${raw_line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"

  if [[ -z "$line" || "${line:0:1}" == "#" ]]; then
    continue
  fi

  if [[ "$line" != *=* ]]; then
    echo "Invalid artifact line (missing '='): $line"
    exit 1
  fi

  key="${line%%=*}"
  value="${line#*=}"

  if [[ ! "$key" =~ ^[A-Z0-9_]+$ ]]; then
    echo "Invalid artifact key '$key' in $artifact_file"
    exit 1
  fi

  case "$key" in
    IMAGE_TAG)
      ;;
    API_IMAGE)
      api_image="$value"
      ;;
    WORKER_IMAGE)
      worker_image="$value"
      ;;
    *)
      echo "Unexpected artifact key '$key' in $artifact_file"
      exit 1
      ;;
  esac
done < "$artifact_file"

if [[ -z "$api_image" || -z "$worker_image" ]]; then
  echo "Artifact is missing API_IMAGE or WORKER_IMAGE"
  exit 1
fi

printf 'API_IMAGE=%s\n' "$api_image"
printf 'WORKER_IMAGE=%s\n' "$worker_image"
