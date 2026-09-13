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
const { verificarMimosBoticario } = require("./Comandos/BoticarioMimo");
const { monitorBoticario } = require("./Comandos/BoticarioMimo/monitor");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const pino = require("pino");

const PREFIX = "/";
const SALVAR_REQUISICOES_TXT = true;
const COMMANDS_CONFIG_FILE = path.join(__dirname, "comandos-config.json");
const AUTH_FOLDER = path.join(__dirname, "auth_info_baileys");
const runningByChat = new Set();

const COMMANDS = {
  help: ["help", "ajuda", "comandos"],
  cacaushow: ["cacaushow"],
  encurtar: ["encurtar"],
  fuel: ["fuel"],
  boticariomimo: ["boticariomimo", "boticario", "mimo"],
};

const DEFAULT_COMMANDS_CONFIG = {
  help: { ativo: true, autorizados: ["*"] },
  cacaushow: { ativo: true, autorizados: ["*"] },
  encurtar: { ativo: true, autorizados: ["*"] },
  fuel: { ativo: true, autorizados: ["*"] },
  boticariomimo: { ativo: true, autorizados: ["558487672874"] },
};

// ─── Utilitários de status e permissões ───────────────────────────────────────

function getSenderIdentifiers(message) {
  const ids = new Set();
  const rawJid = message.key.participant || message.key.remoteJid || "";
  const cleanId = rawJid.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (cleanId) ids.add(cleanId);

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

  return {
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

// ─── Handler de mensagens ─────────────────────────────────────────────────────

async function handleMessage(sock, message) {
  try {
    // Ignora mensagens sem conteúdo, de broadcast ou enviadas pelo próprio bot
    if (!message.message) return;
    if (isJidBroadcast(message.key.remoteJid)) return;
    if (message.key.fromMe) return;

    const from = message.key.remoteJid;

    // Extrai o texto da mensagem (suporta texto simples, extendedText e listResponseMessage)
    const content =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.listResponseMessage?.title ||
      "";

    const commandsConfig = getCommandsConfig();
    const senderIdentifiers = getSenderIdentifiers(message);
    const encurtarData = parseEncurtarCommand(content);
    const fuelData = parseFuelCommand(content, PREFIX, COMMANDS.fuel);
    const boticarioMimoData = parseBoticarioMimoCommand(content);

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

    // /boticariomimo [cidade]
    if (boticarioMimoData) {
      if (!(await checkCommandAccess("boticariomimo"))) return;

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
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
  }
}

// ─── Conexão com o Baileys ────────────────────────────────────────────────────

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  const nomeConexao = getConnectionName();
  console.log(`🔌 Conectando ao WhatsApp como: "${nomeConexao}"`);

  const sock = makeWASocket({
    version,
    auth: state,
    // Logger silencioso — mude para 'info' ou 'debug' se quiser mais detalhes
    logger: pino({ level: "silent" }),
    printQRInTerminal: false, // exibimos manualmente via qrcode-terminal
    browser: [nomeConexao, "Chrome", "1.0.0"],
    syncFullHistory: false,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
    getMessage: async (key) => undefined,
  });

  // Exibe QR Code no terminal
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 Escaneie o QR Code abaixo com o WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `🔌 Conexão encerrada (código ${statusCode}). Reconectando: ${shouldReconnect}`
      );

      if (shouldReconnect) {
        // Aguarda 3 segundos antes de tentar reconectar
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log(
          "🚪 Sessão encerrada (logout). Apague a pasta auth_info_baileys e reinicie."
        );
      }
    }

    if (connection === "open") {
      console.log("✅ Allysongs Bot conectado ao WhatsApp com sucesso!");
      monitorBoticario.iniciar({
        getSock: () => sock,
        sendTextWithLog,
      });
    }
  });

  // Salva credenciais sempre que atualizadas
  sock.ev.on("creds.update", saveCreds);

  // Processa mensagens recebidas
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      await handleMessage(sock, msg);
    }
  });
}

// ─── Inicialização ────────────────────────────────────────────────────────────

connectToWhatsApp().catch((error) => {
  console.error("❌ Falha ao iniciar o bot:", error);
  process.exit(1);
});
