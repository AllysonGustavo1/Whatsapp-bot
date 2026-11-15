const path = require("path");
const { gerarCPF } = require("../Americanas/utils/generators");
const {
  decodificarJwt,
  tokenEstaExpirado,
  renovarToken,
  consultarHomeGrelha,
  abrirGrelha,
  girarGrelha,
  extrairDetalhesPremio,
  ehRecompensaGratis,
  formatarDescricaoPremio,
  formatarResultadoGrelha,
  baixarImagemBuffer,
  gerarQrCodePngBuffer,
} = require("./services/bkApi");
const { criarEmailTemporarioBk } = require("./services/emailCode");
const { autenticarContaNoChrome } = require("./services/chromeAuth");
const { encerrarNox } = require("./services/adbEmulator");
const {
  CONTAS_TXT_PATH,
  resolverCaminhoContas,
  lerContasTxt,
  adicionarContasTxt,
  lerSessoes,
  obterSessaoConta,
  salvarSessaoConta,
} = require("./storage");

const STATUS_JA_USADOS = new Set([
  "REWARD_EXPIRED",
  "UNAVAILABLE",
  "EXPIRED",
  "REDEEMED",
  "COMPLETED",
  "ALREADY_PLAYED",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nomeExibicaoConta(conta, sessao) {
  return (
    conta.email ||
    sessao?.email ||
    conta.customerId ||
    sessao?.customerId ||
    `linha ${conta.linhaNumero || "?"}`
  );
}

function extrairQuantidade(token) {
  const qtdRaw = Number.parseInt(token || "1", 10);
  return Number.isFinite(qtdRaw) ? Math.max(1, Math.min(10, qtdRaw)) : 1;
}

function buildBkHelpMessage(prefix = "/") {
  const arq = path.relative(process.cwd(), CONTAS_TXT_PATH);
  return [
    "🍔 *Burger King — Grelha (Shake & Win)*",
    "",
    `• \`${prefix}bk\` ou \`${prefix}grelha\` (ou \`${prefix}bk girar [qtd]\`) — Cria conta descartável no Mail.tm, autentica no Chrome, gira a grelha e envia a imagem do prêmio (com \`JACKPOT!\` se grátis, \`PREMIO: ... | Codigo: ...\` e \`Conta: cpf:senha\`) e o QR Code em seguida`,
    `• \`${prefix}bk criar [qtd]\` — Mesmo fluxo automático (até 10 contas por vez)`,
    `• \`${prefix}bk txt\` (ou \`${prefix}bk ler\`) — Gira as contas salvas em \`${arq}\``,
    `• \`${prefix}bk contas\` — Lista contas cadastradas e status das sessões salvas`,
    `• \`${prefix}bk add <email:senha ou token>\` — Adiciona uma ou mais linhas no \`contas.txt\``,
    `• \`${prefix}bk help\` — Mostra esta ajuda`,
  ].join("\n");
}

function parseBkCommand(text, prefix = "/") {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = trimmed.match(
    new RegExp(`^${escapedPrefix}(bk|bkgrelha|grelha)(?:\\s+([\\s\\S]+))?$`, "i")
  );
  if (!match) return null;

  const comandoUsado = match[1].toLowerCase();
  const resto = (match[2] || "").trim();

  if (!resto) {
    return { action: "criar", comandoUsado, quantidade: 1 };
  }

  const primeiraLinha = resto.split(/\r?\n/)[0].trim();
  const tokens = primeiraLinha.split(/\s+/);
  const sub = tokens[0].toLowerCase();
  const argTexto = resto.slice(tokens[0].length).trim();

  if (["help", "ajuda", "?"].includes(sub)) {
    return { action: "help", comandoUsado };
  }
  if (
    ["girar", "spin", "rodar", "run", "grelhar", "criar", "nova", "novas", "create"].includes(
      sub
    )
  ) {
    return {
      action: "criar",
      comandoUsado,
      quantidade: extrairQuantidade(tokens[1]),
    };
  }
  if (["txt", "ler", "arquivo"].includes(sub)) {
    return { action: "txt", comandoUsado };
  }
  if (["contas", "lista", "listar", "status"].includes(sub)) {
    return { action: "contas", comandoUsado };
  }
  if (["add", "adicionar", "importar"].includes(sub)) {
    return { action: "add", comandoUsado, argTexto };
  }

  return { action: "unknown", comandoUsado, sub };
}

async function obterCredenciaisAtivas(conta, { onLog, forcarEmulador = false } = {}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  const sessao = obterSessaoConta(conta) || {};

  let accessToken = !forcarEmulador
    ? conta.accessToken || sessao.accessToken || null
    : null;
  let refreshToken = !forcarEmulador
    ? conta.refreshToken || sessao.refreshToken || null
    : null;
  let customerId =
    conta.customerId ||
    sessao.customerId ||
    decodificarJwt(accessToken || refreshToken)?.sub ||
    null;
  const email = conta.email || sessao.email || null;
  const cpf = conta.cpf || sessao.cpf || null;

  // 1) Access token ainda valido em cache
  if (accessToken && !tokenEstaExpirado(accessToken, 90) && customerId) {
    return {
      accessToken,
      refreshToken,
      customerId,
      email,
      cpf,
      metodoAuth: "cache",
    };
  }

  // 2) Tenta renovar via refresh_token (sem abrir emulador)
  if (refreshToken) {
    try {
      const novo = await renovarToken(refreshToken);
      const atualizado = {
        accessToken: novo.accessToken,
        refreshToken: novo.refreshToken || refreshToken,
        customerId: novo.customerId || customerId,
        email: novo.email || email,
        cpf,
      };
      salvarSessaoConta(conta.chave, {
        ...atualizado,
        origem: sessao.origem || "refresh_token",
      });
      return { ...atualizado, metodoAuth: "refresh_token" };
    } catch (err) {
      log(
        `Refresh token falhou para ${nomeExibicaoConta(conta, sessao)}: ${err.message}`
      );
      if (!email) {
        throw new Error(
          `Refresh token expirado/invalido e conta sem email para reautenticar (${err.message}).`
        );
      }
    }
  }

  // 3) Login via Chrome (sem flags de automacao) + Mail.tm
  if (!email) {
    throw new Error(
      "Conta informada apenas com access_token expirado (sem refresh_token ou email)."
    );
  }

  let cpfAtual = cpf;
  let sessaoChrome = null;
  for (let tentativaCpf = 1; tentativaCpf <= 3; tentativaCpf += 1) {
    try {
      sessaoChrome = await autenticarContaNoChrome({
        email,
        senha: conta.senha,
        cpf: cpfAtual,
        onLog: log,
      });
      break;
    } catch (err) {
      const colisaoCpf =
        err?.code === "CPF_JA_CADASTRADO" ||
        /ja possui cadastro/i.test(String(err?.message || ""));
      if (!colisaoCpf || tentativaCpf >= 3) {
        throw err;
      }
      log("CPF ja cadastrado no BK, gerando novo CPF e tentando novamente...");
      cpfAtual = gerarCPF();
      conta.cpf = cpfAtual;
    }
  }
  await sleep(1500);

  const payload = decodificarJwt(sessaoChrome.accessToken);
  const finalCreds = {
    accessToken: sessaoChrome.accessToken,
    refreshToken: sessaoChrome.refreshToken,
    customerId: sessaoChrome.customerId || payload?.sub || customerId,
    email: sessaoChrome.email || email,
    cpf: sessaoChrome.cpf || cpfAtual,
  };

  salvarSessaoConta(conta.chave, {
    ...finalCreds,
    origem: "chrome",
  });

  return { ...finalCreds, metodoAuth: "chrome" };
}

async function montarResultadoGiro({
  label,
  status,
  metodoAuth,
  resumo,
  detalhes = {},
  fallbackDetalhes = {},
  creds = {},
  conta = {},
  log = () => {},
}) {
  const premio =
    detalhes.premioExibicao ||
    detalhes.title ||
    detalhes.description ||
    fallbackDetalhes.premioExibicao ||
    fallbackDetalhes.title ||
    fallbackDetalhes.description ||
    "Sem premio";
  const cupom = detalhes.couponCode || fallbackDetalhes.couponCode || null;
  const descricaoPremio = formatarDescricaoPremio(premio, cupom);
  const imageUrl = detalhes.imageUrl || fallbackDetalhes.imageUrl || null;
  const jackpot = Boolean(
    detalhes.jackpot ??
      fallbackDetalhes.jackpot ??
      ehRecompensaGratis({
        ...detalhes,
        premioExibicao: premio,
        imageUrl,
      })
  );
  const qrCodeBase64 =
    detalhes.qrCodeBase64 || fallbackDetalhes.qrCodeBase64 || null;

  const imagemPremioBuffer = imageUrl
    ? await baixarImagemBuffer(imageUrl).catch((err) => {
        log(`Falha ao baixar imagem do premio: ${err.message}`);
        return null;
      })
    : null;

  const qrCodeBuffer =
    qrCodeBase64 || cupom
      ? await gerarQrCodePngBuffer(cupom || premio, { qrCodeBase64 }).catch(
          (err) => {
            log(`Falha ao gerar QR Code: ${err.message}`);
            return null;
          }
        )
      : null;

  return {
    conta: label,
    status,
    metodoAuth,
    resumo,
    premio,
    cupom,
    jackpot,
    descricaoPremio,
    imageUrl,
    imagemPremioBuffer,
    qrCodeBuffer,
    email: creds.email || conta.email || null,
    senha: conta.senha || null,
    cpf: creds.cpf || conta.cpf || null,
  };
}

async function enviarMidiasResultado(send, giro) {
  if (!giro || giro.status === "erro" || giro.status === "ja_girou") return;

  const identificadorConta = giro.cpf || giro.email || null;
  const linhaConta = identificadorConta
    ? `Conta: ${identificadorConta}${giro.senha ? `:${giro.senha}` : ""}`
    : null;

  const captionPremio = [
    giro.jackpot ? "JACKPOT!" : null,
    giro.descricaoPremio,
    linhaConta,
  ]
    .filter(Boolean)
    .join("\n");

  if (Buffer.isBuffer(giro.imagemPremioBuffer)) {
    await send({
      tipo: "premio_imagem",
      image: giro.imagemPremioBuffer,
      caption: captionPremio,
      descricaoPremio: giro.descricaoPremio,
      jackpot: Boolean(giro.jackpot),
    });
  } else {
    await send(captionPremio || giro.resumo);
  }

  if (Buffer.isBuffer(giro.qrCodeBuffer)) {
    await send({
      tipo: "qrcode_imagem",
      image: giro.qrCodeBuffer,
    });
  } else if (giro.cupom) {
    await send(`Codigo para escaneamento/resgate no totem: *${giro.cupom}*`);
  }
}

async function processarContaGrelha(conta, { onLog } = {}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  const label = nomeExibicaoConta(conta, obterSessaoConta(conta));

  let creds = await obterCredenciaisAtivas(conta, { onLog: log });
  await consultarHomeGrelha(creds.accessToken, creds.customerId).catch(() => null);
  let getRes = await abrirGrelha(creds.accessToken, creds.customerId);

  // Caso o accessToken em cache tenha sido invalidado antes da expiracao
  if (getRes.status === 401 || getRes.status === 403) {
    log(`Token rejeitado (${getRes.status}) para ${label}, renovando sessao...`);
    if (creds.refreshToken) {
      try {
        const renovado = await renovarToken(creds.refreshToken);
        creds = {
          ...creds,
          accessToken: renovado.accessToken,
          refreshToken: renovado.refreshToken || creds.refreshToken,
          customerId: renovado.customerId || creds.customerId,
          metodoAuth: "refresh_retry",
        };
        salvarSessaoConta(conta.chave, {
          accessToken: creds.accessToken,
          refreshToken: creds.refreshToken,
          customerId: creds.customerId,
          email: creds.email,
        });
        await consultarHomeGrelha(creds.accessToken, creds.customerId).catch(
          () => null
        );
        getRes = await abrirGrelha(creds.accessToken, creds.customerId);
      } catch {
        creds = await obterCredenciaisAtivas(conta, {
          onLog: log,
          forcarEmulador: true,
        });
        await consultarHomeGrelha(creds.accessToken, creds.customerId).catch(
          () => null
        );
        getRes = await abrirGrelha(creds.accessToken, creds.customerId);
      }
    } else if (creds.email) {
      creds = await obterCredenciaisAtivas(conta, {
        onLog: log,
        forcarEmulador: true,
      });
      await consultarHomeGrelha(creds.accessToken, creds.customerId).catch(
        () => null
      );
      getRes = await abrirGrelha(creds.accessToken, creds.customerId);
    }
  }

  const getDetalhes = extrairDetalhesPremio(getRes.data);
  if (getRes.status === 404) {
    const resumo = formatarResultadoGrelha(null, getRes);
    salvarSessaoConta(conta.chave, {
      ultimoGiroEm: new Date().toISOString(),
      ultimoResultado: resumo,
    });
    return {
      conta: label,
      status: "erro",
      metodoAuth: creds.metodoAuth,
      resumo,
      premio: null,
      cupom: null,
      descricaoPremio: null,
      imageUrl: null,
      imagemPremioBuffer: null,
      qrCodeBuffer: null,
      email: creds.email || conta.email || null,
      senha: conta.senha || null,
      cpf: creds.cpf || conta.cpf || null,
    };
  }

  if (
    getRes.status === 200 &&
    getDetalhes.statusCode &&
    STATUS_JA_USADOS.has(String(getDetalhes.statusCode).toUpperCase())
  ) {
    const resumo = `Já girou / indisponível hoje (${getDetalhes.statusCode}${
      getDetalhes.title ? ` | Prêmio: ${getDetalhes.title}` : ""
    }${getDetalhes.couponCode ? ` | Código: ${getDetalhes.couponCode}` : ""})`;
    salvarSessaoConta(conta.chave, {
      ultimoGiroEm: new Date().toISOString(),
      ultimoResultado: resumo,
      ultimoCupom: getDetalhes.couponCode || null,
    });
    return montarResultadoGiro({
      label,
      status: "ja_girou",
      metodoAuth: creds.metodoAuth,
      resumo,
      detalhes: getDetalhes,
      creds,
      conta,
      log,
    });
  }

  let postRes;
  try {
    postRes = await girarGrelha(creds.accessToken, creds.customerId);
  } catch (errPost) {
    log(`Falha/timeout no giro (${errPost.message}), verificando estado e tentando novamente...`);
    await sleep(1500);
    const checkAfter = await abrirGrelha(creds.accessToken, creds.customerId).catch(
      () => null
    );
    const afterDetalhes = extrairDetalhesPremio(checkAfter?.data);
    if (
      checkAfter?.status === 200 &&
      afterDetalhes.statusCode &&
      afterDetalhes.statusCode !== getDetalhes.statusCode
    ) {
      postRes = checkAfter;
    } else {
      postRes = await girarGrelha(creds.accessToken, creds.customerId);
    }
  }

  let postDetalhes = extrairDetalhesPremio(postRes.data);
  if (
    postRes.status >= 200 &&
    postRes.status < 300 &&
    (!postDetalhes.couponCode || !postDetalhes.imageUrl)
  ) {
    const checkPosGiro = await abrirGrelha(
      creds.accessToken,
      creds.customerId
    ).catch(() => null);
    if (checkPosGiro?.status === 200 && checkPosGiro.data) {
      const checkDetalhes = extrairDetalhesPremio(checkPosGiro.data);
      if (checkDetalhes.couponCode || checkDetalhes.imageUrl) {
        postDetalhes = {
          ...checkDetalhes,
          ...postDetalhes,
          couponCode: postDetalhes.couponCode || checkDetalhes.couponCode,
          qrCodeBase64:
            postDetalhes.qrCodeBase64 || checkDetalhes.qrCodeBase64,
          imageUrl: postDetalhes.imageUrl || checkDetalhes.imageUrl,
          premioExibicao:
            postDetalhes.premioExibicao && postDetalhes.premioExibicao !== "Sem premio"
              ? postDetalhes.premioExibicao
              : checkDetalhes.premioExibicao,
        };
        postDetalhes.jackpot = ehRecompensaGratis(postDetalhes);
        postDetalhes.descricaoPremio = formatarDescricaoPremio(
          postDetalhes.premioExibicao,
          postDetalhes.couponCode
        );
      }
    }
  }

  const resumo = formatarResultadoGrelha(postRes, getRes);

  const statusLogico =
    postRes.status >= 200 && postRes.status < 300
      ? "sucesso"
      : postRes.status === 400 &&
          /Shake Unavailable/i.test(String(postRes.raw || ""))
        ? "ja_girou"
        : "erro";

  salvarSessaoConta(conta.chave, {
    ultimoGiroEm: new Date().toISOString(),
    ultimoResultado: resumo,
    ultimoCupom: postDetalhes.couponCode || getDetalhes.couponCode || null,
  });

  return montarResultadoGiro({
    label,
    status: statusLogico,
    metodoAuth: creds.metodoAuth,
    resumo,
    detalhes: postDetalhes,
    fallbackDetalhes: getDetalhes,
    creds,
    conta,
    log,
  });
}

function formatarRelatorioGiro(resultados, caminhoTxt) {
  let ok = 0;
  let jaGirou = 0;
  let erros = 0;

  const linhas = resultados.map((r, i) => {
    let icone = "❌";
    if (r.status === "sucesso") {
      icone = r.cupom || r.premio ? "🎁" : "✅";
      ok += 1;
    } else if (r.status === "ja_girou") {
      icone = "⏭️";
      jaGirou += 1;
    } else {
      erros += 1;
    }
    const authTag = r.metodoAuth ? ` [${r.metodoAuth}]` : "";
    return `${i + 1}. ${icone} *${r.conta}*${authTag}\n   ${r.resumo}`;
  });

  const relArq = path.relative(process.cwd(), caminhoTxt);
  return [
    `🔥 *Resultado Grelha BK* (${resultados.length} conta(s))`,
    `📄 Arquivo: \`${relArq}\``,
    "",
    ...linhas,
    "",
    `📊 Resumo: *${ok}* giro(s) OK | *${jaGirou}* já girada(s) | *${erros}* erro(s)`,
  ].join("\n");
}

async function executarGiroGrelha({
  arquivoTxt = null,
  onOutput,
  fecharEmuladorNoFinal = false,
} = {}) {
  const send = typeof onOutput === "function" ? onOutput : async () => {};
  const { caminho, contas } = lerContasTxt(arquivoTxt);

  if (contas.length === 0) {
    await send(
      `⚠️ Nenhuma conta encontrada em \`${path.relative(process.cwd(), caminho)}\`.\n` +
        `Adicione contas usando \`/bk add email:senha\` ou edite o arquivo.`
    );
    return { resultados: [], relatorio: "" };
  }

  await send(
    `🔥 Iniciando Grelha BK em *${contas.length}* conta(s)...`
  );

  const resultados = [];
  let usouEmulador = false;

  for (let i = 0; i < contas.length; i += 1) {
    const conta = contas[i];
    const label = nomeExibicaoConta(conta, obterSessaoConta(conta));
    const logFn = (msg) => {
      console.log(`[BK][${label}] ${msg}`);
    };

    try {
      const res = await processarContaGrelha(conta, { onLog: logFn });
      if (res.metodoAuth === "emulador") usouEmulador = true;
      resultados.push(res);
      if (
        res.status !== "erro" &&
        res.status !== "ja_girou" &&
        (res.imagemPremioBuffer || res.qrCodeBuffer)
      ) {
        await enviarMidiasResultado(send, res);
      }
    } catch (err) {
      resultados.push({
        conta: label,
        status: "erro",
        metodoAuth: null,
        resumo: err?.message || "Erro desconhecido",
        premio: null,
        cupom: null,
      });
    }

    if (i < contas.length - 1) {
      await sleep(700);
    }
  }

  if (fecharEmuladorNoFinal && usouEmulador) {
    await encerrarNox().catch(() => {});
  }

  const relatorio = formatarRelatorioGiro(resultados, caminho);
  await send(relatorio);
  return { resultados, relatorio };
}

function listarContasStatus(arquivoTxt = null) {
  const { caminho, contas } = lerContasTxt(arquivoTxt);
  const relArq = path.relative(process.cwd(), caminho);

  if (contas.length === 0) {
    return (
      `📋 Arquivo \`${relArq}\` está vazio.\n` +
      `Use \`/bk add email:senha\` ou \`/bk criar\` para adicionar contas.`
    );
  }

  const linhas = contas.map((c, idx) => {
    const sessao = obterSessaoConta(c);
    const nome = nomeExibicaoConta(c, sessao);
    const temRefresh = Boolean(c.refreshToken || sessao?.refreshToken);
    const temAccessValido =
      Boolean(c.accessToken || sessao?.accessToken) &&
      !tokenEstaExpirado(c.accessToken || sessao?.accessToken, 60);
    const estadoToken = temAccessValido
      ? "Access ativo"
      : temRefresh
        ? "Refresh salvo"
        : c.email
          ? "Vai autenticar no Nox"
          : "Token incompleto";
    const ultimo = sessao?.ultimoGiroEm
      ? ` | Último: ${sessao.ultimoResultado || sessao.ultimoGiroEm}`
      : "";
    return `${idx + 1}. \`${nome}\` (${c.tipo}) — ${estadoToken}${ultimo}`;
  });

  return [
    `📋 *Contas BK Grelha* (${contas.length}) — \`${relArq}\``,
    "",
    ...linhas,
  ].join("\n");
}

async function executarAdicionarContas({ argTexto, arquivoTxt = null }) {
  if (!argTexto || !argTexto.trim()) {
    return (
      "⚠️ Informe pelo menos uma conta.\n" +
      "Exemplo: `/bk add conta1@fldubai.com:BkGrelha2024@`"
    );
  }
  const linhas = argTexto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const res = adicionarContasTxt(linhas, arquivoTxt);
  return (
    `✅ *${res.adicionadas.length}* conta(s) adicionada(s)!\n` +
    (res.ignoradas.length > 0
      ? `⏭️ Ignoradas/duplicadas: *${res.ignoradas.length}*\n`
      : "") +
    `📋 Total atual no arquivo: *${res.total}* conta(s).`
  );
}

function ehErroIndisponibilidadeAuth(err) {
  const code = String(err?.code || "").toUpperCase();
  if (code === "WORKER_UNAVAILABLE" || code === "ADB_NOT_FOUND") return true;
  const msg = String(err?.message || "");
  return /ADB nao encontrado|Worker BK indisponivel|ECONNREFUSED/i.test(msg);
}

function foiGiradaHoje(sessao) {
  if (!sessao?.ultimoGiroEm) return false;
  const dtGiro = new Date(sessao.ultimoGiroEm);
  if (Number.isNaN(dtGiro.getTime())) return false;
  return dtGiro.toDateString() === new Date().toDateString();
}

function coletarCandidatosPool(arquivoTxt) {
  const candidatos = [];
  const chavesVistas = new Set();

  const { contas } = lerContasTxt(arquivoTxt);
  for (const c of contas) {
    const sessao = obterSessaoConta(c);
    const refresh = c.refreshToken || sessao?.refreshToken || null;
    const accessValido =
      (c.accessToken && !tokenEstaExpirado(c.accessToken, 90) && c.customerId) ||
      (sessao?.accessToken &&
        !tokenEstaExpirado(sessao.accessToken, 90) &&
        (sessao.customerId || c.customerId));
    if (!refresh && !accessValido) continue;
    chavesVistas.add(c.chave);
    candidatos.push({
      conta: c,
      sessao,
      jaGirouHoje: foiGiradaHoje(sessao),
      atualizadoTs: Date.parse(sessao?.atualizadoEm || 0) || 0,
    });
  }

  const db = lerSessoes();
  for (const [chave, sessao] of Object.entries(db.contas || {})) {
    if (!sessao || typeof sessao !== "object") continue;
    const keyNorm = chave.includes("@") ? chave.toLowerCase() : chave;
    if (chavesVistas.has(keyNorm)) continue;
    const accessValido =
      sessao.accessToken &&
      !tokenEstaExpirado(sessao.accessToken, 90) &&
      sessao.customerId;
    if (!sessao.refreshToken && !accessValido) continue;

    chavesVistas.add(keyNorm);
    candidatos.push({
      conta: {
        tipo: "email",
        chave: keyNorm,
        email: sessao.email || (keyNorm.includes("@") ? keyNorm : null),
        senha: null,
        cpf: sessao.cpf || null,
        customerId: sessao.customerId || null,
        accessToken: sessao.accessToken || null,
        refreshToken: sessao.refreshToken || null,
      },
      sessao,
      jaGirouHoje: foiGiradaHoje(sessao),
      atualizadoTs: Date.parse(sessao.atualizadoEm || 0) || 0,
    });
  }

  candidatos.sort((a, b) => {
    if (a.jaGirouHoje !== b.jaGirouHoje) return a.jaGirouHoje ? 1 : -1;
    return b.atualizadoTs - a.atualizadoTs;
  });

  return candidatos;
}

async function girarContaDisponivelDoPool({
  arquivoTxt = null,
  girar = true,
  log = () => {},
  chavesJaUsadas = new Set(),
} = {}) {
  const candidatos = coletarCandidatosPool(arquivoTxt).filter(
    (item) => !chavesJaUsadas.has(item.conta.chave)
  );
  if (candidatos.length === 0) return null;

  let melhorJaGirou = null;
  for (const { conta } of candidatos) {
    try {
      if (!girar) {
        const creds = await obterCredenciaisAtivas(conta, { onLog: log });
        chavesJaUsadas.add(conta.chave);
        return {
          conta: creds.email || conta.chave,
          status: "sucesso",
          metodoAuth: `${creds.metodoAuth || "refresh_token"}+pool`,
          resumo: `Conta autenticada via pool (ID: ${creds.customerId})`,
          premio: null,
          cupom: null,
        };
      }

      const res = await processarContaGrelha(conta, { onLog: log });
      if (res.status === "sucesso") {
        chavesJaUsadas.add(conta.chave);
        return {
          ...res,
          metodoAuth: `${res.metodoAuth || "refresh_token"}+pool`,
        };
      }
      if (
        res.status === "ja_girou" &&
        (res.cupom || res.premio) &&
        (!melhorJaGirou || (!melhorJaGirou.cupom && res.cupom))
      ) {
        melhorJaGirou = {
          ...res,
          chavePool: conta.chave,
          metodoAuth: `${res.metodoAuth || "refresh_token"}+pool`,
        };
      }
    } catch (errPool) {
      log(`Conta do pool (${conta.chave}) indisponivel no fallback: ${errPool.message}`);
    }
  }

  if (melhorJaGirou) {
    const chave = melhorJaGirou.chavePool;
    delete melhorJaGirou.chavePool;
    if (chave) chavesJaUsadas.add(chave);
    return melhorJaGirou;
  }

  return null;
}

async function executarCriarContasBk({
  quantidade = 1,
  girar = true,
  arquivoTxt = null,
  onOutput,
  fecharEmuladorNoFinal = false,
} = {}) {
  const send = typeof onOutput === "function" ? onOutput : async () => {};
  const qtd = Math.max(1, Math.min(10, Number(quantidade) || 1));

  await send(
    `🧪 Criando conta descartável no Mail.tm e girando a Grelha BK (*${qtd}*)...`
  );

  const resultados = [];

  for (let i = 0; i < qtd; i += 1) {
    let email = null;
    let senha = "BkGrelha2024@";
    const cpf = gerarCPF();
    const logFn = (msg) => console.log(`[BK-Criar][${email || `#${i + 1}`}] ${msg}`);

    try {
      const criado = await criarEmailTemporarioBk(senha);
      email = criado.email;
      senha = criado.senha || criado.senhaMailbox || senha;

      const conta = {
        tipo: "email",
        chave: email.toLowerCase(),
        email: email.toLowerCase(),
        senha,
        cpf,
      };

      if (girar) {
        const giro = await processarContaGrelha(conta, { onLog: logFn });
        const sessaoSalva = obterSessaoConta(conta);
        if (sessaoSalva?.refreshToken || sessaoSalva?.accessToken) {
          adicionarContasTxt(
            [`${email}:${senha}:${giro.cpf || cpf}`],
            arquivoTxt
          );
        }
        resultados.push(giro);
        await enviarMidiasResultado(send, giro);
      } else {
        const creds = await obterCredenciaisAtivas(conta, { onLog: logFn });
        adicionarContasTxt(
          [`${creds.email || email}:${senha}:${creds.cpf || cpf}`],
          arquivoTxt
        );
        resultados.push({
          conta: creds.email || email,
          status: "sucesso",
          metodoAuth: creds.metodoAuth,
          resumo: `Conta autenticada (ID: ${creds.customerId})`,
          premio: null,
          cupom: null,
        });
      }
    } catch (err) {
      logFn(`Falha ao criar/girar conta: ${err?.message || "Erro desconhecido"}`);
      resultados.push({
        conta: email || `Nova conta #${i + 1}`,
        status: "erro",
        metodoAuth: null,
        resumo: err?.message || "Erro ao criar/autenticar conta",
        premio: null,
        cupom: null,
      });
    }
  }

  if (fecharEmuladorNoFinal) {
    await encerrarNox().catch(() => {});
  }

  const relatorio = formatarRelatorioGiro(
    resultados,
    resolverCaminhoContas(arquivoTxt)
  );
  if (
    qtd > 1 ||
    !girar ||
    resultados.some((r) => r.status === "erro" || r.status === "ja_girou")
  ) {
    await send(relatorio);
  }
  return { resultados, relatorio };
}

module.exports = {
  buildBkHelpMessage,
  parseBkCommand,
  executarGiroGrelha,
  listarContasStatus,
  executarAdicionarContas,
  executarCriarContasBk,
  processarContaGrelha,
  montarResultadoGiro,
  enviarMidiasResultado,
};
