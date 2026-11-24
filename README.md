# Allysongs Bot (WhatsApp)

Bot de WhatsApp feito com `@whiskeysockets/baileys`.

## Funcionalidades

- `/help` · `/ajuda` · `/comandos` — lista os comandos disponíveis
- `/americanas` — consulta pedidos, códigos de retirada, cria contas e gerencia perfil na Americanas
- `/cacaushow` — gera conta e resgata trufa na Cacau Show
- `/encurtar {link}` — encurta uma URL
- `/fuel {p.gasolina} {p.etanol} {km/l gas} {km/l eta}` — calcula qual combustível é mais vantajoso
- `/boticariomimo [cidade]` — verifica disponibilidade de brindes/mimos nas lojas O Boticário

## Estrutura

```
Comandos/
├── Americanas/           # consulta de pedidos, códigos de retirada, criação de contas e perfil
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

---

## 🛍️ Americanas (`/americanas`)

Módulo completo e 100% autônomo (não depende de pastas externas) para automatizar a Americanas com **isolamento exclusivo por usuário**: cada usuário acessa e interage apenas com as contas criadas por ele mesmo.

### Subcomandos:

#### 1. Consultar Pedidos (`/americanas pedidos`)
- `/americanas pedidos` — consulta pedidos e códigos de retirada de 4 dígitos de todas as contas do usuário.
- `/americanas pedidos detalhado` — inclui lista de produtos comprados, quantidades e valores de cada pedido.
- `/americanas pedidos 1667939111935-01` — consulta um pedido específico diretamente.
- `/americanas pedidos email:senha` — consulta uma conta avulsa enviada na hora.

#### 2. Criar Contas (`/americanas criar conta`)
Cria e-mail temporário via Mail.tm, recebe código VTEX de 6 dígitos, define senha e preenche perfil completo (Nome, CPF válido, Telefone, Nascimento, Sexo e Endereço para liberação de Checkout). O perfil e o endereço fictícios ficam salvos na conta e no checkout — ao comprar, os dados já vêm pré-preenchidos.
- `/americanas criar conta` — cria 1 conta usando seu perfil salvo (ou dados automáticos).
- `/americanas criar conta 2` — cria 2 contas em lote.
- `/americanas criar conta contas=2 nome="Carlos Silva" senha="MinhaSenha123"` — cria com campos específicos.

#### 3. Perfil Padrão (`/americanas perfil`)
Salva seus dados uma única vez para não precisar digitá-los a cada criação de conta:
- `/americanas perfil` — exibe seu perfil atual e indica quais campos estão fixados e quais serão sorteados como `Aleatório`.
- `/americanas perfil nome="Allyson Silva" senha="MinhaSenha123" nascimento="2000-05-23" sexo="masculino"` — salva seus dados fixos.
- `/americanas perfil limpar` — remove o perfil fixo para voltar a gerar todos os campos aleatoriamente.

#### 4. Limpar Pedidos Resgatados (`/americanas limpar resgatados`)
- `/americanas limpar resgatados` (ou `/americanas excluir resgatados` / `/americanas limpar`) — verifica os status das compras e exclui automaticamente do banco de dados local as contas cujos pedidos já foram entregues/retirados na loja. Contas aguardando retirada são mantidas.

#### 5. Listar Contas Salvas (`/americanas contas`)
- `/americanas contas` — lista os e-mails e senhas de todas as contas ativas do usuário.

### Burger King Grelha (`/bk`, `/grelha`)

Cria automaticamente uma conta descartável no Mail.tm, autentica no Nox (`Nox_5` por padrão) via ADB + DevTools WebView, gira a Grelha (Shake & Win) do Burger King e retorna no WhatsApp:
1. A **imagem do prêmio** ganho com `JACKPOT!` (quando a recompensa for item grátis e não promoção de preço), `PREMIO: ... | Codigo: ...` e `Conta: cpf:senha`;
2. O **QR Code em imagem** em seguida sem descrição, pronto para escanear.

- Contas geradas e tokens ficam salvos em `Comandos/BkGrelha/contas.txt` e `Comandos/BkGrelha/dados/sessoes.json`.
- O modo opcional `/bk txt` (ou `/bk ler`) também permite girar contas previamente salvas em `Comandos/BkGrelha/contas.txt` (`email:senha`, `email:senha:cpf`, `email`, `email|refresh_token` ou JWT).

Comandos no WhatsApp:
- `/bk` ou `/grelha` (ou `/bk girar [qtd]` / `/bk criar [qtd]`) — cria conta(s) via Mail.tm + Nox, gira a grelha e envia imagem do prêmio (`JACKPOT!`, `PREMIO: ... | Codigo: ...`, `Conta: cpf:senha`) e QR Code sem descrição.
- `/bk txt` (ou `/bk ler`) — gira todas as contas do `contas.txt`.
- `/bk contas` — lista as contas e o status das sessões salvas.
- `/bk add <conta>` — adiciona uma ou mais linhas no `contas.txt` (aceita múltiplas linhas).
- `/bk help` — exibe a ajuda do módulo.

Execução via terminal (CLI):
- `npm run bk` — cria uma conta descartável Mail.tm, gira a grelha e gera as imagens de prêmio e QR Code.
- `node Comandos/BkGrelha/cli.js txt --arquivo caminho.txt --fechar` — gira as contas de um arquivo `.txt` e fecha o Nox ao terminar.
- `node Comandos/BkGrelha/cli.js contas` — lista as contas/sessões.

---

## Configuração de Comandos e Permissões

Edite o arquivo `comandos-config.json` para ligar/desligar comandos e definir quem pode usá-los:

```json
{
  "help": { "ativo": true, "autorizados": ["*"] },
  "americanas": { "ativo": true, "autorizados": ["*"] },
  "cacaushow": { "ativo": true, "autorizados": ["*"] },
  "encurtar": { "ativo": true, "autorizados": ["*"] },
  "fuel": { "ativo": true, "autorizados": ["*"] },
  "boticariomimo": { "ativo": true, "autorizados": ["558487672874"] },
  "bk": { "ativo": true, "autorizados": ["*"] }
}
```

- `"ativo"`: `true` para ligado, `false` para desligado.
- `"autorizados"`: `["*"]` para liberar a todos, ou uma lista de números específicos.

## Variáveis de Ambiente (`.env`)

Copie o `.env.example` para `.env` e configure conforme necessário:

```env
# Dados O Boticário
BOTICARIO_CONSUMER_NAME=NOME EXEMPLO
BOTICARIO_CONSUMER_CPF=00000000000
BOTICARIO_CONSUMER_BIRTHDAY=1990-01-01
BOTICARIO_CONSUMER_GENDER=F
BOTICARIO_CONSUMER_MOTHER_NAME=NOME DA MAE

# Americanas / Mail.tm (Opcionais com padrões prontos)
AMERICANAS_DEFAULT_PASSWORD=Zelele123
AMERICANAS_DEFAULT_MAIL_PASSWORD=AmericanasMail123!
MAILTM_BASE_URL=https://api.mail.tm
AMERICANAS_BASE_URL=https://www.americanas.com.br
```

## Logs de requisições

Quando `SALVAR_REQUISICOES_TXT = true` (definido no `index.js`), os logs do `/cacaushow` são salvos na pasta `logs-requisicoes/`.

## Observações

- A pasta `Comandos/Americanas/dados/` armazena as contas e perfis locais e está no `.gitignore`.
- Os arquivos `Comandos/BkGrelha/contas.txt` e `Comandos/BkGrelha/dados/` contêm contas e tokens locais do BK e também estão no `.gitignore`.
- Para forçar uma nova autenticação, delete a pasta `auth_info_baileys/` e reinicie o bot.
