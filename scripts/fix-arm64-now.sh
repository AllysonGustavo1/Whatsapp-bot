#!/usr/bin/env bash
set -e

echo "🔧 FIX ARM64 - Chromium"

sudo rm -f /etc/apt/sources.list.d/google-chrome.list || true
sudo apt update
sudo apt install -y chromium-browser || sudo apt install -y chromium || true

if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
  sudo apt install -y snapd
  sudo snap install chromium
fi

CHROME_BIN="$(command -v chromium-browser || command -v chromium || command -v /snap/bin/chromium || true)"
if [ -z "${CHROME_BIN}" ]; then
  echo "❌ Chromium não encontrado"
  exit 1
fi

echo "✅ Chromium pronto: ${CHROME_BIN}"
"${CHROME_BIN}" --version || true
