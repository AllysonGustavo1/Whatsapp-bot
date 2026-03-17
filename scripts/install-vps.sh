#!/usr/bin/env bash
set -e

echo "[1/5] Atualizando pacotes..."
sudo apt update

echo "[2/5] Instalando dependências de runtime do Chrome..."
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
  fonts-liberation

echo "[3/5] Instalando Google Chrome do .deb na raiz do projeto..."
if [ -f "./google-chrome-stable_current_amd64.deb" ]; then
  sudo dpkg -i ./google-chrome-stable_current_amd64.deb || true
  sudo apt-get install -f -y
else
  echo "Arquivo google-chrome-stable_current_amd64.deb não encontrado na raiz."
  exit 1
fi

echo "[4/5] Verificando Chrome..."
google-chrome-stable --version || true

echo "[5/5] Instalando dependências Node e finalizado."
npm install

echo "OK: ambiente VPS preparado."
