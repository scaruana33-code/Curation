#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 22.13+ is required: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install --omit=dev
exec node local.js
