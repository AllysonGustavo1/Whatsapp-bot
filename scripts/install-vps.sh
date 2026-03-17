#!/usr/bin/env bash
set -e

echo "🚀 INSTALAÇÃO VPS - ALLYSONGS BOT"
echo "=================================="

if ! command -v apt >/dev/null 2>&1; then
  echo "❌ Este script requer Ubuntu/Debian"
  exit 1
fi

ARCH="$(dpkg --print-architecture)"
echo "🧠 Arquitetura detectada: ${ARCH}"

echo "[1/6] Atualizando pacotes..."
sudo apt update

echo "[2/6] Instalando dependências básicas..."
sudo apt install -y curl ca-certificates gnupg software-properties-common

echo "[3/6] Instalando dependências de runtime do browser..."
sudo apt install -y \
  libnss3 \
  libxss1 \
  libasound2 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  xdg-utils \
  xvfb \
  fonts-liberation

echo "[4/6] Instalando navegador compatível..."
if [ "${ARCH}" = "amd64" ] && [ -f "./google-chrome-stable_current_amd64.deb" ]; then
  echo "✅ Usando .deb local do Google Chrome (amd64)"
  sudo dpkg -i ./google-chrome-stable_current_amd64.deb || true
  sudo apt-get install -f -y
else
  echo "✅ Instalando Chromium (ARM64/x86 fallback)"
  sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium || true
  if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
    sudo apt-get install -y snapd
    sudo snap install chromium
  fi
fi

echo "[5/6] Instalando dependências Node..."
npm install

echo "[6/6] Verificando navegador detectado..."
CHROME_BIN="$(command -v chromium-browser || command -v chromium || command -v google-chrome-stable || command -v /snap/bin/chromium || true)"
if [ -z "${CHROME_BIN}" ]; then
  echo "❌ Nenhum browser encontrado após instalação"
  exit 1
fi

echo "✅ Browser: ${CHROME_BIN}"
"${CHROME_BIN}" --version || true
echo "✅ Setup finalizado"
