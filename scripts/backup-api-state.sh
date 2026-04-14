#!/usr/bin/env bash
# Deprecated name — runs the full stack backup (env, oauth, api/data, DB dump, manifest).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-full-state.sh" "$@"
