# Allysongs Bot (WhatsApp)

Bot de WhatsApp feito com `@whiskeysockets/baileys`.

## Funcionalidades

- `/help` · `/ajuda` · `/comandos` — lista os comandos disponíveis
- `/cacaushow` — gera conta e resgata trufa na Cacau Show
- `/encurtar {link}` — encurta uma URL
- `/fuel {p.gasolina} {p.etanol} {km/l gas} {km/l eta}` — calcula qual combustível é mais vantajoso

## Estrutura

```
Comandos/
├── CacauShowGenerator/   # gerador de conta Cacau Show
├── Encurtador/           # encurtador de links
└── Fuel/                 # comparador gasolina × etanol
index.js
comandos-status.txt
```

## Requisitos

- Node.js 18+
- NPM

## Instalação

```bash
npm install
npm start
```

Na primeira execução será exibido um QR Code no terminal. Escaneie com o WhatsApp para autenticar.  
As credenciais ficam salvas na pasta `auth_info_baileys/` e não precisam ser geradas novamente.

## Configuração de comandos

Edite o arquivo `comandos-status.txt` para ligar ou desligar comandos individualmente:

```txt
help=on
cacaushow=on
encurtar=on
fuel=on
```

Valores aceitos para ativar: `on`, `ativo`, `ligado`, `true`, `1`.  
Qualquer outro valor será tratado como desligado.

## Logs de requisições

Quando `SALVAR_REQUISICOES_TXT = true` (definido no `index.js`), os logs do `/cacaushow` são salvos na pasta `logs-requisicoes/`.

## Observações

- A pasta `auth_info_baileys/` contém as credenciais da sessão — não a versione no Git.
- Para forçar uma nova autenticação, delete a pasta e reinicie o bot.
