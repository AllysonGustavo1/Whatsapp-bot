#!/usr/bin/env bash
set -e

echo "🧪 TESTE VPS UBUNTU"

[ -f /etc/os-release ] && . /etc/os-release && echo "OS: $NAME $VERSION"
echo "ARCH: $(uname -m)"

echo "Node: $(node --version 2>/dev/null || echo 'não instalado')"
echo "NPM: $(npm --version 2>/dev/null || echo 'não instalado')"

echo "Chrome bin (prioridade):"
command -v chromium-browser || true
command -v chromium || true
command -v google-chrome-stable || true
command -v /snap/bin/chromium || true

CHROME_BIN="$(command -v chromium-browser || command -v chromium || command -v google-chrome-stable || command -v /snap/bin/chromium || true)"
if [ -n "${CHROME_BIN}" ]; then
  echo "Browser detectado: ${CHROME_BIN}"
  "${CHROME_BIN}" --version || true
else
  echo "❌ Nenhum browser detectado"
fi

echo "Memória:" && free -h
