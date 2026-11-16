const fs = require("fs");
const path = require("path");

function carregarEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
carregarEnv();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
} = require("@whiskeysockets/baileys");
const { criarMembro } = require("./Comandos/CacauShowGenerator");
const { encurtarLink } = require("./Comandos/Encurtador");
const { calcularCombustivel } = require("./Comandos/Fuel");
const {
  verificarMimosBoticario,
  extrairSlugCampanha,
  validarCampanha,
  salvarCampanhaConfig,
  obterCampanhaAtiva,
  iniciarAgendadorDiarioCampanha,
} = require("./Comandos/BoticarioMimo");
const { monitorBoticario } = require("./Comandos/BoticarioMimo/monitor");
const {
  buildAmericanasHelpMessage,
  parseAmericanasCommand,
  executarPedidos,
  executarCriarConta,
  executarLimparResgatados,
  executarPerfil,
  obterContasUsuario,
} = require("./Comandos/Americanas");
const {
  buildBkHelpMessage,
  parseBkCommand,
  executarAdicionarContas,
  executarGerarCuponsBk,
  executarCriarContasBk,
} = require("./Comandos/BkGrelha");
const qrcode = require("qrcode-terminal");
const pino = require("pino");

const PREFIX = "/";
const SALVAR_REQUISICOES_TXT = true;
const COMMANDS_CONFIG_FILE = path.join(__dirname, "comandos-config.json");
const AUTH_FOLDER = path.join(__dirname, "auth_info_baileys");
const runningByChat = new Set();
const processedMessageIds = new Set();

function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  if (processedMessageIds.has(messageId)) {
    return true;
  }
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > 1000) {
    const oldest = processedMessageIds.values().next().value;
    processedMessageIds.delete(oldest);
  }
  return false;
}

const COMMANDS = {
  help: ["help", "ajuda", "comandos"],
  cacaushow: ["cacaushow"],
  encurtar: ["encurtar"],
  fuel: ["fuel"],
  boticariomimo: ["boticariomimo", "boticario", "mimo"],
  americanas: ["americanas", "ame"],
  bk: ["bk", "bkgrelha", "grelha"],
};

const DEFAULT_COMMANDS_CONFIG = {
  help: { ativo: true, autorizados: ["*"] },
  cacaushow: { ativo: true, autorizados: ["*"] },
  encurtar: { ativo: true, autorizados: ["*"] },
  fuel: { ativo: true, autorizados: ["*"] },
  boticariomimo: {
    ativo: true,
    autorizados: ["*"],
    campanha: "floratta-blue-crystal-14-2026",
  },
  americanas: { ativo: true, autorizados: ["*"] },
  bk: { ativo: true, autorizados: ["*"] },
};

// ─── Utilitários de status e permissões ───────────────────────────────────────

function getSenderIdentifiers(message, sock) {
  const ids = new Set();
  const rawJid = message.key.participant || message.key.remoteJid || "";
  const cleanId = rawJid.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (cleanId) ids.add(cleanId);

  if (message.key.fromMe && sock?.user?.id) {
    const myPhone = sock.user.id.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (myPhone) ids.add(myPhone);
  }

  // Se o JID for um @lid, busca o número de telefone correspondente salvo pelo Baileys
  if (rawJid.includes("@lid")) {
    try {
      const mappingPath = path.join(
        AUTH_FOLDER,
        `lid-mapping-${cleanId}_reverse.json`
      );
      if (fs.existsSync(mappingPath)) {
        const phone = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
        const cleanPhone = String(phone || "").replace(/\D/g, "");
        if (cleanPhone) ids.add(cleanPhone);
      }
    } catch (err) {
      // silencioso
    }
  }

  // Verifica campos alternativos do Baileys
  if (message.key.remoteJidAlt) {
    const alt = String(message.key.remoteJidAlt)
      .split("@")[0]
      .split(":")[0]
      .replace(/\D/g, "");
    if (alt) ids.add(alt);
  }
  if (message.key.participantAlt) {
    const alt = String(message.key.participantAlt)
      .split("@")[0]
      .split(":")[0]
      .replace(/\D/g, "");
    if (alt) ids.add(alt);
  }

  return Array.from(ids);
}

function getCommandsConfig() {
  try {
    if (fs.existsSync(COMMANDS_CONFIG_FILE)) {
      const raw = fs.readFileSync(COMMANDS_CONFIG_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.boticariomimo) {
        parsed.boticariomimo.autorizados = ["*"];
      }
      return { ...DEFAULT_COMMANDS_CONFIG, ...parsed };
    }

    fs.writeFileSync(
      COMMANDS_CONFIG_FILE,
      JSON.stringify(DEFAULT_COMMANDS_CONFIG, null, 2),
      "utf8"
    );
    return DEFAULT_COMMANDS_CONFIG;
  } catch (error) {
    console.error("Erro ao ler comandos-config.json:", error.message);
    return DEFAULT_COMMANDS_CONFIG;
  }
}

function isCommandAuthorized(config, commandName, senderIdentifiers) {
  // /boticariomimo liberado para todos os usuários
  if (commandName === "boticariomimo") {
    return true;
  }

  const cmdConfig = config[commandName];
  if (!cmdConfig) return true;

  const autorizados = cmdConfig.autorizados || ["*"];
  if (!Array.isArray(autorizados) || autorizados.includes("*")) {
    return true;
  }

  const ids = Array.isArray(senderIdentifiers)
    ? senderIdentifiers
    : [senderIdentifiers];

  return ids.some((senderId) => {
    const cleanSender = String(senderId || "").replace(/\D/g, "");
    if (!cleanSender) return false;

    return autorizados.some((item) => {
      const cleanItem = String(item).replace(/\D/g, "");
      return (
        cleanItem &&
        (cleanSender === cleanItem ||
          cleanSender.endsWith(cleanItem) ||
          cleanItem.endsWith(cleanSender))
      );
    });
  });
}

function isBkAdminAuthorized(config, senderIdentifiers, from, message) {
  if (message?.key?.fromMe) return true;

  const envAdmins = String(process.env.BK_ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const cfgAdmins = Array.isArray(config?.bk?.adminAutorizados)
    ? config.bk.adminAutorizados
    : [];
  const autorizados = [
    ...new Set([
      "558487672874",
      "558487672874-1561671344@g.us",
      ...cfgAdmins,
      ...envAdmins,
    ]),
  ];

  const candidatos = [
    ...(Array.isArray(senderIdentifiers) ? senderIdentifiers : [senderIdentifiers]),
    from,
  ]
    .filter(Boolean)
    .map((v) => String(v));

  return candidatos.some((cand) => {
    const cleanCand = cand.split("@")[0].replace(/\D/g, "");
    return autorizados.some((item) => {
      const strItem = String(item);
      if (cand === strItem) return true;
      const cleanItem = strItem.split("@")[0].replace(/\D/g, "");
      return (
        cleanCand &&
        cleanItem &&
        (cleanCand === cleanItem ||
          cleanCand.endsWith(cleanItem) ||
          cleanItem.endsWith(cleanCand))
      );
    });
  });
}

// ─── Nome da Conexão / Ambiente ───────────────────────────────────────────────

function getConnectionName() {
  if (process.env.BOT_NAME) {
    return process.env.BOT_NAME;
  }

  const config = getCommandsConfig();
  if (config.nomeConexao) {
    return config.nomeConexao;
  }

  const isProduction =
    process.env.NODE_ENV === "production" || process.platform === "linux";
  return isProduction ? "Allysongs Bot Prod" : "Allysongs Bot Teste";
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

function buildHelpMessage(config) {
  const nomeBot = getConnectionName();
  const label = (cmdName) =>
    config[cmdName]?.ativo ? "✅ ativo" : "⛔ desligado";
  return [
    `🤖 *${nomeBot}*`,
    "",
    "Comandos disponíveis:",
    `/help - ${label("help")}`,
    `/ajuda - ${label("help")}`,
    `/comandos - ${label("help")}`,
    `/cacaushow - ${label("cacaushow")}`,
    `/encurtar {link} - ${label("encurtar")}`,
    `/fuel {p.gasolina} {p.etanol} {km/l gas} {km/l eta} - ${label("fuel")}`,
    `/boticariomimo [cidade] - ${label("boticariomimo")}`,
    `/americanas - ${label("americanas")}`,
    `/bk - ${label("bk")}`,
  ].join("\n");
}

// ─── Parsing de comandos ──────────────────────────────────────────────────────

function normalizeCommand(text = "") {
  return text.trim().toLowerCase().replace(/^\//, "");
}

function isHelpCommand(text = "") {
  if (!text.startsWith(PREFIX)) return false;
  const cmd = normalizeCommand(text);
  return COMMANDS.help.includes(cmd);
}

function isCacauShowCommand(text = "") {
  if (!text.startsWith(PREFIX)) return false;
  const cmd = normalizeCommand(text);
  return COMMANDS.cacaushow.includes(cmd);
}

function parseEncurtarCommand(text = "") {
  if (!text.startsWith(PREFIX)) return null;
  const trimmed = text.trim();
  const [rawCmd, ...args] = trimmed.split(/\s+/);
  const cmd = normalizeCommand(rawCmd);
  if (!COMMANDS.encurtar.includes(cmd)) return null;

  return {
    originalUrl: args.join(" ").trim(),
  };
}

function parseFuelCommand(text = "") {
  if (!text.startsWith(PREFIX)) return null;
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = normalizeCommand(rawCmd);
  if (!COMMANDS.fuel.includes(cmd)) return null;

  if (args.length < 4) return { incompleto: true };

  const [precoGasolina, precoEtanol, kmLGasolina, kmLEtanol] = args.map(
    (v) => parseFloat(v.replace(",", "."))
  );

  if ([precoGasolina, precoEtanol, kmLGasolina, kmLEtanol].some((n) => isNaN(n) || n <= 0)) {
    return { invalido: true };
  }

  return { precoGasolina, precoEtanol, kmLGasolina, kmLEtanol };
}

function parseBoticarioMimoCommand(text = "") {
  if (!text.startsWith(PREFIX)) return null;
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = normalizeCommand(rawCmd);
  if (!COMMANDS.boticariomimo.includes(cmd)) return null;

  const primeiroArg = (args[0] || "").toLowerCase();

  // Subcomando: /boticariomimo campanha [link ou slug]
  if (primeiroArg === "campanha" || primeiroArg === "brinde") {
    const valor = args.slice(1).join(" ").trim();
    return {
      tipo: "campanha",
      valor,
    };
  }

  // Subcomando: /boticariomimo atualizar
  if (primeiroArg === "atualizar" || primeiroArg === "sync") {
    return {
      tipo: "atualizar",
    };
  }

  // Se passou diretamente um link: /boticariomimo https://campanha.boticario...
  if (primeiroArg.includes("campanha.boticario.com.br")) {
    return {
      tipo: "campanha",
      valor: args.join(" ").trim(),
    };
  }

  return {
    tipo: "monitor",
    cidade: args.join(" ").trim() || "Natal",
  };
}

// ─── Log e envio ─────────────────────────────────────────────────────────────

function logRequest(from, content) {
  if (!content.startsWith(PREFIX)) return;
  console.log(`[REQ] ${from}: ${content}`);
}

async function sendTextWithLog(sock, to, text) {
  const output = String(text);
  console.log(`[RES] ${to}: ${output}`);
  await sock.sendMessage(to, { text: output });
}

async function sendImageWithLog(sock, to, imageBuffer, caption = "") {
  const legenda = caption ? String(caption).trim() : "";
  console.log(
    `[RES-IMG] ${to}: ${legenda || "(sem legenda)"} (${imageBuffer?.length || 0} bytes)`
  );
  const payload = legenda
    ? { image: imageBuffer, caption: legenda }
    : { image: imageBuffer };
  await sock.sendMessage(to, payload);
}

// ─── Handler de mensagens ─────────────────────────────────────────────────────

async function handleMessage(sock, message) {
  try {
    // Ignora mensagens sem conteúdo ou de broadcast
    if (!message.message) return;
    if (isJidBroadcast(message.key.remoteJid)) return;

    // Evita processamento duplicado (ex: mesma mensagem entregue em 'append' e 'notify')
    const messageId = message.key?.id;
    if (isDuplicateMessage(messageId)) return;

    // Ignora mensagens antigas (mais de 60s) para evitar reexecutar comandos do histórico sincronizado
    const msgTime = Number(message.messageTimestamp || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (msgTime && nowSec - msgTime > 60) return;

    // Extrai o texto da mensagem (suporta texto simples, extendedText e listResponseMessage)
    const content =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.listResponseMessage?.title ||
      "";

    // Se a mensagem partiu da própria conta (fromMe):
    // Só processa se for um comando (iniciado com PREFIX).
    // Isso ignora conversas comuns e todas as mensagens/alertas enviados pelo próprio bot.
    if (message.key.fromMe && !content.trim().startsWith(PREFIX)) {
      return;
    }

    const from = message.key.remoteJid;

    const commandsConfig = getCommandsConfig();
    const senderIdentifiers = getSenderIdentifiers(message, sock);
    const encurtarData = parseEncurtarCommand(content);
    const fuelData = parseFuelCommand(content, PREFIX, COMMANDS.fuel);
    const boticarioMimoData = parseBoticarioMimoCommand(content);
    const americanasData = parseAmericanasCommand(content, PREFIX);
    const bkData = parseBkCommand(content, PREFIX);

    logRequest(from, content);

    // Helper genérico para verificar ativação e permissão do comando
    const checkCommandAccess = async (commandName) => {
      const cmdConfig = commandsConfig[commandName];
      if (cmdConfig && !cmdConfig.ativo) {
        await sendTextWithLog(
          sock,
          from,
          `⛔ O comando /${commandName} está desligado no momento.`
        );
        return false;
      }
      if (!isCommandAuthorized(commandsConfig, commandName, senderIdentifiers)) {
        await sendTextWithLog(
          sock,
          from,
          `⛔ Você não tem permissão para usar o comando /${commandName}.`
        );
        return false;
      }
      return true;
    };

    // /help /ajuda /comandos
    if (isHelpCommand(content)) {
      if (!(await checkCommandAccess("help"))) return;
      await sendTextWithLog(sock, from, buildHelpMessage(commandsConfig));
      return;
    }

    // /encurtar {link}
    if (encurtarData) {
      if (!(await checkCommandAccess("encurtar"))) return;

      if (!encurtarData.originalUrl) {
        await sendTextWithLog(sock, from, "⚠️ Use: /encurtar {link}");
        return;
      }

      try {
        const { shortUrl } = await encurtarLink(encurtarData.originalUrl);
        await sendTextWithLog(sock, from, `✅ Link encurtado: ${shortUrl}`);
      } catch (error) {
        const messageText = String(error?.message || "").toLowerCase();
        if (messageText.includes("url")) {
          await sendTextWithLog(
            sock,
            from,
            "❌ URL inválida. Envie um link começando com http:// ou https://"
          );
          return;
        }
        console.error("Erro no /encurtar:", error);
        await sendTextWithLog(
          sock,
          from,
          "❌ Não foi possível encurtar o link agora. Tente novamente em instantes."
        );
      }

      return;
    }

    // /fuel {preço gasolina} {preço etanol} {km/l gasolina} {km/l etanol}
    if (fuelData) {
      if (!(await checkCommandAccess("fuel"))) return;

      if (fuelData.incompleto) {
        await sendTextWithLog(
          sock,
          from,
          "⚠️ Use: /fuel {preço gasolina} {preço etanol} {km/l gasolina} {km/l etanol}\n" +
            "Exemplo: /fuel 6.19 4.49 12 8"
        );
        return;
      }

      if (fuelData.invalido) {
        await sendTextWithLog(
          sock,
          from,
          "❌ Valores inválidos. Use números positivos.\n" +
            "Exemplo: /fuel 6.19 4.49 12 8"
        );
        return;
      }

      try {
        const resultado = calcularCombustivel(
          fuelData.precoGasolina,
          fuelData.precoEtanol,
          fuelData.kmLGasolina,
          fuelData.kmLEtanol
        );
        await sendTextWithLog(sock, from, resultado.mensagem);
      } catch (error) {
        console.error("Erro no /fuel:", error);
        await sendTextWithLog(
          sock,
          from,
          "❌ Erro ao calcular. Verifique os valores e tente novamente."
        );
      }

      return;
    }

    // /cacaushow
    if (isCacauShowCommand(content)) {
      if (!(await checkCommandAccess("cacaushow"))) return;

      if (runningByChat.has(from)) {
        await sendTextWithLog(
          sock,
          from,
          "⏳ Já existe uma geração em andamento para este chat."
        );
        return;
      }

      runningByChat.add(from);
      await sendTextWithLog(
        sock,
        from,
        "🚀 Iniciando o gerador Cacau Show. Aguarde as próximas mensagens..."
      );

      try {
        await criarMembro({
          salvarRequisicoesTxt: SALVAR_REQUISICOES_TXT,
          onOutput: async (texto) => {
            await sendTextWithLog(sock, from, String(texto));
          },
        });

        await sendTextWithLog(sock, from, "✅ Fluxo finalizado.");
      } catch (error) {
        console.error("Erro no /cacaushow:", error);
        await sendTextWithLog(
          sock,
          from,
          "❌ Ocorreu um erro ao executar o gerador Cacau Show."
        );
      } finally {
        runningByChat.delete(from);
      }
      return;
    }

    // /boticariomimo [cidade | campanha | atualizar]
    if (boticarioMimoData) {
      if (!(await checkCommandAccess("boticariomimo"))) return;

      // 1. Caso: Consulta ou Atualização manual de campanha
      if (boticarioMimoData.tipo === "campanha") {
        if (!boticarioMimoData.valor) {
          const campanhaAtual = await obterCampanhaAtiva();
          const info = await validarCampanha(campanhaAtual);
          await sendTextWithLog(
            sock,
            from,
            `🎁 *Campanha O Boticário Vigente:*\n` +
              `🔹 ID: *${campanhaAtual}*\n` +
              `🔹 Status: *${info.valida ? "Ativa (enabled)" : "Inativa"}*\n` +
              `🔗 https://campanha.boticario.com.br/${campanhaAtual}/CADASTRO\n\n` +
              `_Para alterar manualmente, envie: /boticariomimo campanha [link ou slug]_`
          );
          return;
        }

        const novoSlug = extrairSlugCampanha(boticarioMimoData.valor);
        if (!novoSlug) {
          await sendTextWithLog(
            sock,
            from,
            `❌ Não foi possível identificar o código da campanha no texto informado.\nExemplo: */boticariomimo campanha floratta-blue-crystal-14-2026* ou envie o link da campanha.`
          );
          return;
        }

        await sendTextWithLog(
          sock,
          from,
          `🔎 Validando nova campanha *${novoSlug}* junto à API do O Boticário...`
        );
        const checagem = await validarCampanha(novoSlug);
        if (!checagem.valida) {
          await sendTextWithLog(
            sock,
            from,
            `⚠️ A campanha *${novoSlug}* retornou status: *${checagem.status}*.\nVerifique se o link ou código está correto.`
          );
          return;
        }

        salvarCampanhaConfig(novoSlug);
        await sendTextWithLog(
          sock,
          from,
          `✅ *Nova campanha configurada com sucesso!*\n` +
            `🎁 Campanha: *${novoSlug}*\n` +
            `📅 Início: ${checagem.initialDate ? new Date(checagem.initialDate).toLocaleDateString("pt-BR") : "Imediato"}\n` +
            `📅 Término: ${checagem.finalDate ? new Date(checagem.finalDate).toLocaleDateString("pt-BR") : "A definir"}\n\n` +
            `Todos os monitoramentos agora checam este brinde automaticamente!`
        );
        return;
      }

      // 2. Caso: Busca automática na web por nova campanha
      if (boticarioMimoData.tipo === "atualizar") {
        await sendTextWithLog(
          sock,
          from,
          `🔄 Buscando automaticamente por campanhas ativas do O Boticário na web...`
        );
        const campanhaEncontrada = await obterCampanhaAtiva({
          forcarAtualizacao: true,
        });
        const info = await validarCampanha(campanhaEncontrada);
        await sendTextWithLog(
          sock,
          from,
          `✨ *Resultado da verificação automática:*\n` +
            `🎁 Campanha ativa: *${campanhaEncontrada}*\n` +
            `🔹 Status: *${info.valida ? "Ativa e pronta para resgates" : "Aguardando liberação"}*`
        );
        return;
      }

      // 3. Caso padrão: Toggle de monitoramento para a cidade informada
      const resultadoToggle = monitorBoticario.alternar(
        from,
        boticarioMimoData.cidade
      );
      await sendTextWithLog(sock, from, resultadoToggle.mensagem);

      // Se acabou de ativar, faz uma checagem imediata para já informar a situação atual
      if (resultadoToggle.ativo) {
        try {
          await sendTextWithLog(
            sock,
            from,
            `🔎 Realizando primeira consulta para *${resultadoToggle.cidade}*...`
          );
          const resConsulta = await verificarMimosBoticario({
            cidade: resultadoToggle.cidade,
            salvarTxt: SALVAR_REQUISICOES_TXT,
          });
          await sendTextWithLog(sock, from, resConsulta.mensagem);
        } catch (errCheck) {
          console.error("Erro na checagem inicial do monitor:", errCheck.message);
        }
      }

      return;
    }

    // /americanas [pedidos | criar conta | limpar resgatados | contas]
    if (americanasData) {
      if (!(await checkCommandAccess("americanas"))) return;

      const ownerId = senderIdentifiers[0] || from;

      // 1. Menu de ajuda/opções (/americanas, /americanas help, /americanas ajuda)
      if (americanasData.tipo === "help") {
        await sendTextWithLog(sock, from, buildAmericanasHelpMessage());
        return;
      }

      // 2. Subcomando: /americanas contas (lista as contas salvas do próprio usuário)
      if (americanasData.tipo === "minhas_contas") {
        const contas = obterContasUsuario(ownerId);
        if (contas.length === 0) {
          await sendTextWithLog(
            sock,
            from,
            "⚠️ Você ainda não possui nenhuma conta cadastrada no bot.\nEnvie */americanas criar conta* para gerar sua primeira conta!"
          );
          return;
        }

        const linhas = [
          "📋 *Americanas - Suas Contas Cadastradas*",
          `Total: *${contas.length}* conta(s)\n`,
        ];
        for (let i = 0; i < contas.length; i++) {
          const c = contas[i];
          const nomeStr = c.profile ? `${c.profile.firstName || ""} ${c.profile.lastName || ""}`.trim() : "";
          linhas.push(`*${i + 1}.* \`${c.email}\` | Senha: \`${c.password}\`${nomeStr ? ` (${nomeStr})` : ""}`);
        }
        await sendTextWithLog(sock, from, linhas.join("\n"));
        return;
      }

      // 3. Subcomando: /americanas pedidos [flags / parâmetros]
      if (americanasData.tipo === "pedidos") {
        if (runningByChat.has(from)) {
          await sendTextWithLog(
            sock,
            from,
            "⏳ Já existe uma operação em andamento para este chat. Aguarde a finalização."
          );
          return;
        }

        runningByChat.add(from);
        try {
          const resultado = await executarPedidos({
            ownerId,
            detalhado: americanasData.options.detalhado,
            orderId: americanasData.options.pedido,
            conta: americanasData.options.conta,
            onOutput: async (texto) => {
              await sendTextWithLog(sock, from, String(texto));
            },
          });

          await sendTextWithLog(sock, from, resultado.mensagem);
        } catch (error) {
          console.error("Erro no /americanas pedidos:", error);
          await sendTextWithLog(
            sock,
            from,
            `❌ Erro ao consultar pedidos da Americanas: ${error.message || "Erro desconhecido"}`
          );
        } finally {
          runningByChat.delete(from);
        }
        return;
      }

      // 4. Subcomando: /americanas criar conta [diretrizes]
      if (americanasData.tipo === "criar_conta") {
        if (runningByChat.has(from)) {
          await sendTextWithLog(
            sock,
            from,
            "⏳ Já existe uma operação em andamento para este chat. Aguarde a finalização."
          );
          return;
        }

        runningByChat.add(from);
        try {
          const resultado = await executarCriarConta({
            ownerId,
            options: americanasData.options,
            onOutput: async (texto) => {
              await sendTextWithLog(sock, from, String(texto));
            },
          });

          await sendTextWithLog(sock, from, resultado.mensagem);
        } catch (error) {
          console.error("Erro no /americanas criar conta:", error);
          await sendTextWithLog(
            sock,
            from,
            `❌ Erro ao criar conta na Americanas: ${error.message || "Erro desconhecido"}`
          );
        } finally {
          runningByChat.delete(from);
        }
        return;
      }

      // 5. Subcomando: /americanas limpar resgatados
      if (americanasData.tipo === "limpar_resgatados") {
        if (runningByChat.has(from)) {
          await sendTextWithLog(
            sock,
            from,
            "⏳ Já existe uma operação em andamento para este chat. Aguarde a finalização."
          );
          return;
        }

        runningByChat.add(from);
        try {
          const resultado = await executarLimparResgatados({
            ownerId,
            onOutput: async (texto) => {
              await sendTextWithLog(sock, from, String(texto));
            },
          });

          await sendTextWithLog(sock, from, resultado.mensagem);
        } catch (error) {
          console.error("Erro no /americanas limpar resgatados:", error);
          await sendTextWithLog(
            sock,
            from,
            `❌ Erro ao limpar contas resgatadas: ${error.message || "Erro desconhecido"}`
          );
        } finally {
          runningByChat.delete(from);
        }
        return;
      }

      // 6. Subcomando: /americanas perfil [limpar | reset | diretrizes]
      if (americanasData.tipo === "perfil") {
        try {
          const resultado = await executarPerfil({
            ownerId,
            options: americanasData.options,
            subAcao: americanasData.subAcao,
          });

          await sendTextWithLog(sock, from, resultado.mensagem);
        } catch (error) {
          console.error("Erro no /americanas perfil:", error);
          await sendTextWithLog(
            sock,
            from,
            `❌ Erro ao gerenciar perfil da Americanas: ${error.message || "Erro desconhecido"}`
          );
        }
        return;
      }

      // 7. Subcomando desconhecido
      await sendTextWithLog(
        sock,
        from,
        `⚠️ Opção não reconhecida.\n\n` + buildAmericanasHelpMessage()
      );
      return;
    }

    // /bk | /grelha [gerar [qtd] | criar [qtd] | help]
    if (bkData) {
      if (!(await checkCommandAccess("bk"))) return;

      const isBkAdmin = isBkAdminAuthorized(
        commandsConfig,
        senderIdentifiers,
        from,
        message
      );

      if (bkData.action === "help") {
        await sendTextWithLog(
          sock,
          from,
          buildBkHelpMessage(PREFIX, { isAdmin: isBkAdmin })
        );
        return;
      }

      if (bkData.action === "add" || bkData.action === "criar") {
        if (!isBkAdmin) {
          await sendTextWithLog(
            sock,
            from,
            `⛔ Você não tem permissão para usar o comando ${PREFIX}bk ${bkData.action}.`
          );
          return;
        }
      }

      if (bkData.action === "add") {
        const msg = await executarAdicionarContas({ argTexto: bkData.argTexto });
        await sendTextWithLog(sock, from, msg);
        return;
      }

      if (bkData.action === "gerar" || bkData.action === "criar") {
        if (runningByChat.has(from)) {
          await sendTextWithLog(
            sock,
            from,
            "⏳ Já existe uma operação em andamento para este chat. Aguarde a finalização."
          );
          return;
        }

        const enviarSaidaBk = async (payload) => {
          if (payload && typeof payload === "object" && Buffer.isBuffer(payload.image)) {
            await sendImageWithLog(sock, from, payload.image, payload.caption || "");
          } else if (payload) {
            await sendTextWithLog(sock, from, String(payload));
          }
        };

        runningByChat.add(from);
        try {
          if (bkData.action === "criar") {
            await executarCriarContasBk({
              quantidade: bkData.quantidade || 1,
              girar: true,
              onOutput: enviarSaidaBk,
            });
          } else {
            await executarGerarCuponsBk({
              quantidade: bkData.quantidade || 1,
              onOutput: enviarSaidaBk,
            });
          }
        } catch (error) {
          console.error("Erro no /bk:", error);
          await sendTextWithLog(
            sock,
            from,
            `❌ Erro no comando BK Grelha: ${error.message || "Erro desconhecido"}`
          );
        } finally {
          runningByChat.delete(from);
        }
        return;
      }

      await sendTextWithLog(
        sock,
        from,
        "⚠️ Subcomando BK não reconhecido.\n\n" +
          buildBkHelpMessage(PREFIX, { isAdmin: isBkAdmin })
      );
      return;
    }
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
  }
}

// ─── Conexão com o Baileys ────────────────────────────────────────────────────
//
// Regras importantes para o bot não "morrer" em silêncio:
//  - Só pode existir UM socket ativo. Antes, cada queda criava um socket novo sem
//    fechar o anterior; os sockets antigos continuavam vivos, disputavam a mesma
//    sessão, se derrubavam (código 500/428/440) e corrompiam as chaves de
//    criptografia — e as mensagens/comandos deixavam de ser lidos.
//  - Só pode existir UMA reconexão agendada por vez, com espera crescente.
//  - Se ficar muito tempo sem conexão aberta, o processo sai e o pm2 reinicia.

let currentSock = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let lastOpenAt = Date.now();
let cachedVersion = null;
const sentMessagesCache = new Map(); // usado pelo getMessage (reenvio/retry)
const WATCHDOG_MAX_OFFLINE_MS = 5 * 60 * 1000;

function cacheSentMessage(msg) {
  if (!msg?.key?.id || !msg.message) return;
  sentMessagesCache.set(msg.key.id, msg.message);
  if (sentMessagesCache.size > 500) {
    sentMessagesCache.delete(sentMessagesCache.keys().next().value);
  }
}

function encerrarSocket(sock) {
  if (!sock) return;
  try {
    sock.ev.removeAllListeners();
  } catch (_) {}
  try {
    sock.end(undefined);
  } catch (_) {}
}

function agendarReconexao(motivo) {
  if (reconnectTimer) return; // já existe uma reconexão agendada
  reconnectAttempts++;
  const delay = Math.min(3000 * 2 ** (reconnectAttempts - 1), 60000);
  console.log(
    `🔁 Reconectando em ${Math.round(delay / 1000)}s (tentativa ${reconnectAttempts}, motivo: ${motivo})`
  );
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connectToWhatsApp();
    } catch (error) {
      console.error("❌ Erro ao reconectar:", error?.message || error);
      agendarReconexao("erro ao reconectar");
    }
  }, delay);
}

async function obterVersao() {
  if (cachedVersion) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
  } catch (error) {
    console.warn("⚠️ Não foi possível buscar a versão do WhatsApp Web:", error?.message);
  }
  return cachedVersion || undefined;
}

async function connectToWhatsApp() {
  // Garante que o socket anterior está realmente morto antes de abrir outro
  encerrarSocket(currentSock);
  currentSock = null;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const version = await obterVersao();

  const nomeConexao = getConnectionName();
  console.log(`🔌 Conectando ao WhatsApp como: "${nomeConexao}"`);

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    // Logger silencioso — mude para 'info' ou 'debug' se quiser mais detalhes
    logger: pino({ level: "silent" }),
    printQRInTerminal: false, // exibimos manualmente via qrcode-terminal
    browser: [nomeConexao, "Chrome", "1.0.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    keepAliveIntervalMs: 20000,
    connectTimeoutMs: 60000,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
    getMessage: async (key) => sentMessagesCache.get(key.id),
  });
  currentSock = sock;

  // Guarda as mensagens que o bot envia, para o WhatsApp conseguir pedir reenvio
  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const sent = await originalSendMessage(...args);
    cacheSentMessage(sent);
    return sent;
  };

  sock.ev.on("connection.update", async (update) => {
    if (sock !== currentSock) return; // evento de um socket antigo: ignora

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastOpenAt = Date.now(); // aguardando leitura do QR não conta como "offline"
      console.log("\n📱 Escaneie o QR Code abaixo com o WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(
        `🔌 Conexão encerrada (código ${statusCode}) em ${new Date().toISOString()}`
      );

      encerrarSocket(sock);
      currentSock = null;

      if (statusCode === DisconnectReason.loggedOut) {
        // Sessão invalidada pelo WhatsApp: guarda a pasta antiga como backup e
        // abre uma sessão nova, que mostra o QR Code no log (pm2 logs whatsappBotSunga).
        const backup = `${AUTH_FOLDER}.logout-${Date.now()}`;
        try {
          if (fs.existsSync(AUTH_FOLDER)) fs.renameSync(AUTH_FOLDER, backup);
          console.log(
            `🚪 WhatsApp informou logout (401). Sessão antiga movida para ${backup}. Escaneie o novo QR Code com o celular.`
          );
        } catch (error) {
          console.error("Erro ao mover a sessão antiga:", error?.message);
        }
        lastOpenAt = Date.now() + 10 * 60 * 1000; // dá tempo para ler o QR antes do watchdog agir
        agendarReconexao("logout");
        return;
      }

      agendarReconexao(`código ${statusCode}`);
    }

    if (connection === "open") {
      reconnectAttempts = 0;
      lastOpenAt = Date.now();
      console.log(
        `✅ Allysongs Bot conectado ao WhatsApp com sucesso! (${new Date().toISOString()})`
      );
      monitorBoticario.iniciar({
        getSock: () => currentSock,
        sendTextWithLog,
      });
      iniciarAgendadorDiarioCampanha();
    }
  });

  // Salva credenciais sempre que atualizadas
  sock.ev.on("creds.update", saveCreds);

  // Processa mensagens recebidas (tanto 'notify' quanto 'append').
  // Cada mensagem roda em paralelo: um comando demorado (puppeteer etc.)
  // não trava mais a fila de todos os outros comandos.
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      handleMessage(sock, msg).catch((error) =>
        console.error("Erro ao processar mensagem:", error)
      );
    }
  });
}

// Watchdog: se ficar muito tempo sem conexão aberta, sai e deixa o pm2 reiniciar
setInterval(() => {
  const conectado = currentSock?.ws?.isOpen ?? false;
  if (conectado) {
    lastOpenAt = Date.now();
    return;
  }
  if (Date.now() - lastOpenAt > WATCHDOG_MAX_OFFLINE_MS) {
    console.error("⏱️ Sem conexão com o WhatsApp há mais de 5 minutos. Reiniciando processo.");
    process.exit(1);
  }
}, 30000).unref();

// Erros soltos não devem derrubar o bot sem log
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ unhandledRejection:", reason?.message || reason);
});
process.on("uncaughtException", (error) => {
  console.error("💥 uncaughtException:", error);
  process.exit(1);
});

// ─── Inicialização ────────────────────────────────────────────────────────────

const { garantirAmbientePronto } = require("./scripts/setup-ambiente");

(async () => {
  try {
    await garantirAmbientePronto();
  } catch (errAmbiente) {
    console.warn("[Setup] Aviso ao checar dependências de ambiente:", errAmbiente.message);
  }

  connectToWhatsApp().catch((error) => {
    console.error("❌ Falha ao iniciar o bot:", error);
    process.exit(1);
  });
})();
