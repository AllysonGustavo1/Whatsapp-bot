const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");
const { gerarCPF } = require("../Americanas/utils/generators");
const { decodificarJwt } = require("./services/bkApi");
const { autenticarContaNoEmulador } = require("./services/adbEmulator");
const { salvarSessaoConta } = require("./storage");

const HOST = process.env.BK_WORKER_HOST || "127.0.0.1";
const PORT = Number(process.env.BK_WORKER_PORT) || 3847;
const WORKER_TOKEN = process.env.BK_WORKER_TOKEN || "";

const VPS_HOST = process.env.BK_VPS_HOST || "ubuntu@144.22.149.69";
const VPS_KEY =
  process.env.BK_VPS_KEY || "C:\\Users\\Allyson\\Documents\\VM-1.ppk";
const VPS_HOSTKEY =
  process.env.BK_VPS_HOSTKEY ||
  "SHA256:2WmsWpkJT1azHz+KMsionPMa/vB2o0BM9KHE4KgFZSQ";
const PLINK_PATH =
  process.env.BK_PLINK_PATH || "C:\\Program Files\\PuTTY\\plink.exe";

const MAX_BODY_BYTES = 1024 * 1024;

let filaExecucao = Promise.resolve();
let busy = false;
let queueLength = 0;
let encerrando = false;
let plinkProc = null;
let reconnectTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Payload excedeu limite de 1MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON invalido no corpo da requisicao."));
      }
    });

    req.on("error", reject);
  });
}

function enfileirarTarefa(fn) {
  queueLength += 1;
  const executa = async () => {
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
      queueLength = Math.max(0, queueLength - 1);
    }
  };

  const promessa = filaExecucao.then(executa, executa);
  filaExecucao = promessa.catch(() => {});
  return promessa;
}

async function autenticarComRetryCpf({ email, senha, cpf }) {
  const emailNorm = String(email || "").trim().toLowerCase();
  let cpfAtual = (cpf && String(cpf).replace(/\D/g, "")) || gerarCPF();
  const log = (msg) => console.log(`[BK-Worker][${emailNorm}] ${msg}`);

  let sessaoAdb = null;
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    try {
      sessaoAdb = await autenticarContaNoEmulador({
        email: emailNorm,
        senha: senha || null,
        cpf: cpfAtual,
        onLog: log,
        permitirWorker: false,
      });
      break;
    } catch (err) {
      const colisaoCpf =
        err?.code === "CPF_JA_CADASTRADO" ||
        /ja possui cadastro/i.test(String(err?.message || ""));
      if (!colisaoCpf || tentativa >= 3) {
        throw err;
      }
      log("CPF ja cadastrado no BK, gerando novo CPF e tentando novamente...");
      cpfAtual = gerarCPF();
    }
  }

  await sleep(1500);

  const payload = decodificarJwt(sessaoAdb.accessToken);
  const creds = {
    accessToken: sessaoAdb.accessToken,
    refreshToken: sessaoAdb.refreshToken,
    customerId: sessaoAdb.customerId || payload?.sub || null,
    email: sessaoAdb.email || emailNorm,
    cpf: sessaoAdb.cpf || cpfAtual,
    customerStatus: sessaoAdb.customerStatus || "ACTIVE",
  };

  salvarSessaoConta(emailNorm, {
    ...creds,
    origem: "worker-nox",
  });

  return creds;
}

function autorizacaoValida(req) {
  if (!WORKER_TOKEN) return true;
  const recebido = req.headers["x-bk-worker-token"] || "";
  return String(recebido) === WORKER_TOKEN;
}

async function handleRequest(req, res) {
  const pathname = (req.url || "/").split("?")[0];

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { ok: true, busy, queueLength });
  }

  if (req.method === "POST" && pathname === "/auth") {
    if (!autorizacaoValida(req)) {
      return sendJson(res, 401, { ok: false, error: "Token de worker invalido." });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    if (!body?.email) {
      return sendJson(res, 400, {
        ok: false,
        error: "Campo 'email' obrigatorio para autenticacao.",
      });
    }

    try {
      const creds = await enfileirarTarefa(() =>
        autenticarComRetryCpf({
          email: body.email,
          senha: body.senha,
          cpf: body.cpf,
        })
      );
      return sendJson(res, 200, { ok: true, ...creds });
    } catch (err) {
      return sendJson(res, err?.code === "CPF_JA_CADASTRADO" ? 409 : 500, {
        ok: false,
        code: err?.code || null,
        error: err?.message || "Falha na autenticacao BK via Worker.",
      });
    }
  }

  return sendJson(res, 404, { ok: false, error: "Rota nao encontrada." });
}

function iniciarTunelSshReverso() {
  if (
    process.env.BK_NO_TUNNEL === "1" ||
    process.argv.includes("--no-tunnel")
  ) {
    console.log("[BK-Tunnel] Tunel SSH desabilitado por configuracao.");
    return;
  }

  if (!fs.existsSync(PLINK_PATH)) {
    console.warn(
      `[BK-Tunnel] plink.exe nao encontrado em ${PLINK_PATH}; rodando apenas HTTP local.`
    );
    return;
  }
  if (!fs.existsSync(VPS_KEY)) {
    console.warn(
      `[BK-Tunnel] Chave SSH nao encontrada em ${VPS_KEY}; rodando apenas HTTP local.`
    );
    return;
  }

  const conectar = () => {
    if (encerrando) return;
    const forwardSpec = `127.0.0.1:${PORT}:${HOST}:${PORT}`;
    const args = [
      "-batch",
      "-N",
      "-R",
      forwardSpec,
      "-hostkey",
      VPS_HOSTKEY,
      "-i",
      VPS_KEY,
      VPS_HOST,
    ];

    console.log(`[BK-Tunnel] Conectando tunel reverso ${forwardSpec} -> ${VPS_HOST}...`);
    plinkProc = spawn(PLINK_PATH, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    plinkProc.stdout.on("data", (d) => {
      const txt = d.toString().trim();
      if (txt) console.log(`[BK-Tunnel] ${txt}`);
    });

    plinkProc.stderr.on("data", (d) => {
      const txt = d.toString().trim();
      if (txt) console.warn(`[BK-Tunnel] ${txt}`);
    });

    plinkProc.on("close", (code) => {
      plinkProc = null;
      if (encerrando) return;
      console.warn(
        `[BK-Tunnel] Tunel encerrado (codigo ${code}). Reconectando em 5s...`
      );
      reconnectTimer = setTimeout(conectar, 5000);
    });

    plinkProc.on("error", (err) => {
      console.error(`[BK-Tunnel] Erro ao iniciar plink: ${err.message}`);
    });
  };

  conectar();
}

function iniciarWorkerServer() {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, error: err?.message || "Erro interno." });
    });
  });

  // Permite autenticacao + giro longo no emulador sem derrubar socket HTTP
  server.requestTimeout = 240000;

  server.listen(PORT, HOST, () => {
    console.log(`[BK-Worker] Escutando em http://${HOST}:${PORT}`);
    iniciarTunelSshReverso();
  });

  const finalizar = () => {
    if (encerrando) return;
    encerrando = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (plinkProc) {
      plinkProc.kill();
      plinkProc = null;
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on("SIGINT", finalizar);
  process.on("SIGTERM", finalizar);
  return server;
}

if (require.main === module) {
  iniciarWorkerServer();
}

module.exports = {
  iniciarWorkerServer,
  autenticarComRetryCpf,
};
