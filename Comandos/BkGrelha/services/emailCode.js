const {
  criarEmailTemporario,
  autenticarMailTm,
  listarMensagens,
  obterDetalheMensagem,
} = require("../../Americanas/services/mailtm");

const SENHAS_PADRAO_MAILTM = ["BkGrelha2024@", "AmericanasMail123!"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function erroEhRateLimit(err) {
  const msg = String(err?.message || "");
  return msg.includes("429") || /too many requests/i.test(msg);
}

async function executarComRetry429(fn, { tentativas = 5, delayBaseMs = 2000 } = {}) {
  let ultimoErro = null;
  for (let i = 0; i < tentativas; i += 1) {
    try {
      return await fn();
    } catch (err) {
      ultimoErro = err;
      if (!erroEhRateLimit(err) || i === tentativas - 1) {
        throw err;
      }
      await sleep(delayBaseMs * (i + 1));
    }
  }
  throw ultimoErro;
}

function extrairCodigoBk(texto) {
  if (!texto) return null;
  const limpo = String(texto).replace(/<[^>]+>/g, " ");
  const matchContextual = limpo.match(
    /(?:c[oó]digo|code|verific|acesso)[^\d]{0,40}(\d{6})\b/i
  );
  if (matchContextual) return matchContextual[1];
  const match6 = limpo.match(/\b(\d{6})\b/);
  if (match6) return match6[1];
  return null;
}

async function autenticarComSenhas({ email, senha }) {
  const candidatas = [];
  if (senha) candidatas.push(senha);
  for (const s of SENHAS_PADRAO_MAILTM) {
    if (!candidatas.includes(s)) candidatas.push(s);
  }

  let ultimoErro = null;
  for (const s of candidatas) {
    try {
      const token = await executarComRetry429(() =>
        autenticarMailTm({ email, senha: s, maxRetries: 2 })
      );
      return { token, senhaUsada: s };
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw new Error(
    `Falha ao autenticar Mail.tm para ${email}: ${ultimoErro?.message || "credenciais invalidas"}`
  );
}

async function criarEmailTemporarioBk(senha = "BkGrelha2024@") {
  const criado = await executarComRetry429(
    () => criarEmailTemporario({ senha, prefixo: "bk" }),
    {
      tentativas: 4,
      delayBaseMs: 2500,
    }
  );
  return {
    ...criado,
    senha: criado?.senha || criado?.senhaMailbox || senha,
  };
}

async function snapshotMensagensEmail({ email, senha }) {
  await sleep(600);
  const { token, senhaUsada } = await autenticarComSenhas({ email, senha });
  await sleep(500);
  const lista = await executarComRetry429(() => listarMensagens({ token }), {
    tentativas: 5,
    delayBaseMs: 2000,
  });
  const idsExistentes = new Set(lista.map((m) => m.id).filter(Boolean));
  return {
    token,
    senhaUsada,
    idsExistentes,
    timestampInicio: Date.now(),
  };
}

async function aguardarCodigoBk({
  email,
  senha,
  snapshot = null,
  timeoutMs = 120000,
  intervalMs = 5500,
  onLog,
}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  const ctx = snapshot || (await snapshotMensagensEmail({ email, senha }));
  const deadline = Date.now() + timeoutMs;

  let tentativa = 0;
  while (Date.now() < deadline) {
    tentativa += 1;
    let mensagens = [];
    try {
      mensagens = await executarComRetry429(
        () => listarMensagens({ token: ctx.token }),
        { tentativas: 3, delayBaseMs: 2500 }
      );
    } catch (err) {
      if (erroEhRateLimit(err)) {
        await sleep(intervalMs);
        continue;
      }
      throw err;
    }

    const ordenadas = [...mensagens].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    for (const msg of ordenadas) {
      if (ctx.idsExistentes.has(msg.id)) continue;

      const criadoEm = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
      if (criadoEm && criadoEm < ctx.timestampInicio - 15000) continue;

      const assuntoOuIntro = `${msg.subject || ""} ${msg.intro || ""}`;
      let codigo = extrairCodigoBk(assuntoOuIntro);
      if (!codigo && msg.id) {
        const detalhe = await executarComRetry429(
          () => obterDetalheMensagem({ token: ctx.token, id: msg.id }),
          { tentativas: 3, delayBaseMs: 2000 }
        );
        const html = Array.isArray(detalhe?.html)
          ? detalhe.html.join(" ")
          : String(detalhe?.html || "");
        codigo = extrairCodigoBk(
          `${detalhe?.subject || ""} ${detalhe?.text || ""} ${html}`
        );
      }

      if (codigo) {
        log(`Codigo BK recebido (${codigo}) para ${email}`);
        return codigo;
      }
    }

    if (tentativa % 3 === 1) {
      log(`Aguardando email de codigo BK para ${email}...`);
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timeout aguardando codigo BK no email ${email}`);
}

module.exports = {
  SENHAS_PADRAO_MAILTM,
  extrairCodigoBk,
  autenticarComSenhas,
  criarEmailTemporarioBk,
  snapshotMensagensEmail,
  aguardarCodigoBk,
};
