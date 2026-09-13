# Allysongs Bot (WhatsApp)

Bot de WhatsApp feito com `@whiskeysockets/baileys`.

## Funcionalidades

- `/help` · `/ajuda` · `/comandos` — lista os comandos disponíveis
- `/cacaushow` — gera conta e resgata trufa na Cacau Show
- `/encurtar {link}` — encurta uma URL
- `/fuel {p.gasolina} {p.etanol} {km/l gas} {km/l eta}` — calcula qual combustível é mais vantajoso
- `/boticariomimo [cidade]` — verifica disponibilidade de brindes/mimos nas lojas O Boticário

## Estrutura

```
Comandos/
├── BoticarioMimo/        # consulta de brindes nas lojas O Boticário
├── CacauShowGenerator/   # gerador de conta Cacau Show
├── Encurtador/           # encurtador de links
└── Fuel/                 # comparador gasolina × etanol
index.js
comandos-config.json
comandos-config.example.json
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

## Configuração de comandos e permissões

Edite o arquivo `comandos-config.json` para ligar/desligar comandos e definir quem pode usá-los:

```json
{
  "help": { "ativo": true, "autorizados": ["*"] },
  "cacaushow": { "ativo": true, "autorizados": ["*"] },
  "encurtar": { "ativo": true, "autorizados": ["*"] },
  "fuel": { "ativo": true, "autorizados": ["*"] },
  "boticariomimo": { "ativo": true, "autorizados": ["558487672874"] }
}
```

- `"ativo"`: `true` para ligado, `false` para desligado.
- `"autorizados"`: `["*"]` para liberar a todos, ou uma lista de números específicos.

## Logs de requisições

Quando `SALVAR_REQUISICOES_TXT = true` (definido no `index.js`), os logs do `/cacaushow` são salvos na pasta `logs-requisicoes/`.

## Observações

- A pasta `auth_info_baileys/` contém as credenciais da sessão — não a versione no Git.
- Para forçar uma nova autenticação, delete a pasta e reinicie o bot.
