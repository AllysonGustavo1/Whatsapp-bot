# Allysongs Bot (WhatsApp)

Bot de WhatsApp feito com `@open-wa/wa-automate`.

## Funcionalidades

- Comando de ajuda:
  - `/help`
  - `/ajuda`
  - `/comandos`
- Comando principal:
  - `/cacaushow`
- Status dos comandos via arquivo de configuração:
  - `comandos-status.txt`
- Geração de conta e resgate com envio das respostas no próprio WhatsApp.
- Opcional: salvar logs de requisições em `.txt`.

## Requisitos

- Node.js 18+ (recomendado)
- NPM
- Google Chrome ou Chromium instalado

## Instalação local

```bash
npm install
npm start
```

## Rodando em VPS (Linux)

Para VPS, o projeto está preparado para usar Chrome headless.

### Importante

Se for usar o script de setup da VPS, o arquivo abaixo precisa estar na raiz do projeto:

- `google-chrome-stable_current_amd64.deb`

Ou seja, no mesmo nível de:

- `index.js`
- `package.json`

### Passos na VPS

```bash
npm install
npm run setup:vps
npm run start:vps
```

## Configuração de comandos

Edite o arquivo `comandos-status.txt`:

```txt
help=on
cacaushow=on
```

Valores aceitos para ativar: `on`, `ativo`, `ligado`, `true`, `1`.
Qualquer outro valor será tratado como desligado.

## Logs de requisições

O salvamento de logs `.txt` pode ser ligado/desligado no código principal.
Quando ligado, os arquivos são gerados na pasta `logs-requisicoes`.

## Observações

- Não versione arquivos grandes (`.deb`) no GitHub.
- O projeto já ignora `.deb` no `.gitignore`.
