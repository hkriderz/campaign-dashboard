#!/bin/sh
set -eu

APP_USER="${APP_USER:-nextjs}"
APP_GROUP="${APP_GROUP:-nodejs}"

mkdir -p \
  /app/credentials \
  /app/data/bq-snapshots \
  /app/data/district-classifier/jobs \
  /app/data/district-classifier/uploads \
  /app/data/district-classifier/exports \
  /app/data/district-sort-cache \
  /app/pdi-mappings \
  /app/pdi-sync-exports

if [ "$(id -u)" = "0" ]; then
  for writable_dir in /app/credentials /app/data /app/pdi-mappings /app/pdi-sync-exports; do
    if ! gosu "$APP_USER:$APP_GROUP" test -w "$writable_dir"; then
      chown -R "$APP_USER:$APP_GROUP" "$writable_dir"
    fi
  done

  exec gosu "$APP_USER:$APP_GROUP" "$@"
fi

exec "$@"
