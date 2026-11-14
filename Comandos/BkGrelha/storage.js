const fs = require("fs");
const path = require("path");
const { decodificarJwt } = require("./services/bkApi");

const BASE_DIR = __dirname;
const CONTAS_TXT_PATH = path.join(BASE_DIR, "contas.txt");
const CONTAS_EXAMPLE_PATH = path.join(BASE_DIR, "contas.example.txt");
const DADOS_DIR = path.join(BASE_DIR, "dados");
const SESSOES_PATH = path.join(DADOS_DIR, "sessoes.json");

function garantirDiretorioDados() {
  if (!fs.existsSync(DADOS_DIR)) {
    fs.mkdirSync(DADOS_DIR, { recursive: true });
  }
}

function lerJsonSeguro(caminho, padrao) {
  try {
    if (!fs.existsSync(caminho)) return padrao;
    const raw = fs.readFileSync(caminho, "utf8");
    if (!raw.trim()) return padrao;
    return JSON.parse(raw);
  } catch {
    return padrao;
  }
}

function salvarJsonSeguro(caminho, dados) {
  garantirDiretorioDados();
  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), "utf8");
}

function resolverCaminhoContas(caminhoCustom = null) {
  if (!caminhoCustom) return CONTAS_TXT_PATH;
  return path.isAbsolute(caminhoCustom)
    ? caminhoCustom
    : path.resolve(process.cwd(), caminhoCustom);
}

function classificarJwt(token) {
  const payload = decodificarJwt(token);
  if (!payload) return { val: token, isRefresh: false, payload: null };
  const isRefresh = String(payload.typ || "").toLowerCase() === "refresh";
  return { val: token, isRefresh, payload };
}

function parseContaLinha(linhaBruta, numeroLinha = 0) {
  const linha = String(linhaBruta || "").trim();
  if (!linha || linha.startsWith("#") || linha.startsWith("//")) {
    return null;
  }

  // 1) Token JWT direto (access ou refresh)
  if (linha.startsWith("eyJ") && linha.split(".").length === 3) {
    const info = classificarJwt(linha);
    const sub = info.payload?.sub || null;
    const email = info.payload?.email
      ? String(info.payload.email).toLowerCase()
      : null;
    return {
      linhaNumero: numeroLinha,
      raw: linha,
      tipo: "token",
      chave: email || sub || `token:${linha.slice(0, 24)}`,
      email,
      senha: null,
      cpf: null,
      customerId: sub,
      accessToken: info.isRefresh ? null : linha,
      refreshToken: info.isRefresh ? linha : null,
    };
  }

  // 2) Formato email|token(|token2)
  if (linha.includes("|")) {
    const partes = linha
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    const primeira = partes[0] || "";
    const email = primeira.includes("@") ? primeira.toLowerCase() : null;
    const tokens = email ? partes.slice(1) : partes;
    let accessToken = null;
    let refreshToken = null;
    let customerId = null;

    for (const t of tokens) {
      const info = classificarJwt(t);
      if (info.payload?.sub && !customerId) customerId = info.payload.sub;
      if (info.isRefresh) refreshToken = t;
      else if (t.startsWith("eyJ")) accessToken = t;
      else if (!refreshToken) refreshToken = t;
    }

    return {
      linhaNumero: numeroLinha,
      raw: linha,
      tipo: "email_token",
      chave: email || customerId || `pipe:${linha.slice(0, 24)}`,
      email,
      senha: null,
      cpf: null,
      customerId,
      accessToken,
      refreshToken,
    };
  }

  // 3) Formato email, email:senha, ou email:senha:cpf
  if (linha.includes("@")) {
    const [emailPart, senhaPart, cpfPart] = linha.split(":");
    const email = String(emailPart || "").trim().toLowerCase();
    const senha = senhaPart ? senhaPart.trim() : null;
    const cpfLimpo = cpfPart ? cpfPart.replace(/\D/g, "") : null;
    return {
      linhaNumero: numeroLinha,
      raw: linha,
      tipo: "email",
      chave: email,
      email,
      senha: senha || null,
      cpf: cpfLimpo && cpfLimpo.length === 11 ? cpfLimpo : null,
      customerId: null,
      accessToken: null,
      refreshToken: null,
    };
  }

  return {
    linhaNumero: numeroLinha,
    raw: linha,
    tipo: "desconhecido",
    chave: `raw:${numeroLinha}`,
    email: null,
    senha: null,
    cpf: null,
    customerId: null,
    accessToken: null,
    refreshToken: null,
  };
}

function garantirContasTxt(caminho = CONTAS_TXT_PATH) {
  if (!fs.existsSync(caminho)) {
    const conteudoInicial = fs.existsSync(CONTAS_EXAMPLE_PATH)
      ? fs.readFileSync(CONTAS_EXAMPLE_PATH, "utf8")
      : "# Uma conta por linha (email:senha ou token)\n";
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    fs.writeFileSync(caminho, conteudoInicial, "utf8");
  }
}

function lerContasTxt(caminhoCustom = null) {
  const caminho = resolverCaminhoContas(caminhoCustom);
  if (!fs.existsSync(caminho)) {
    if (!caminhoCustom) {
      garantirContasTxt(caminho);
    } else {
      throw new Error(`Arquivo de contas nao encontrado: ${caminho}`);
    }
  }

  const texto = fs.readFileSync(caminho, "utf8");
  const linhas = texto.split(/\r?\n/);
  const contas = [];
  const chavesVistas = new Set();

  linhas.forEach((raw, idx) => {
    const parsed = parseContaLinha(raw, idx + 1);
    if (!parsed) return;
    if (chavesVistas.has(parsed.chave)) return;
    chavesVistas.add(parsed.chave);
    contas.push(parsed);
  });

  return { caminho, contas };
}

function adicionarContasTxt(novasLinhas, caminhoCustom = null) {
  const caminho = resolverCaminhoContas(caminhoCustom);
  garantirContasTxt(caminho);

  const existentes = lerContasTxt(caminho).contas;
  const chavesExistentes = new Set(existentes.map((c) => c.chave));

  const paraAdicionar = [];
  const ignoradas = [];

  for (const bruta of novasLinhas) {
    const trimmed = String(bruta || "").trim();
    if (!trimmed) continue;
    const parsed = parseContaLinha(trimmed, 0);
    if (!parsed || parsed.tipo === "desconhecido") {
      ignoradas.push(trimmed);
      continue;
    }
    if (chavesExistentes.has(parsed.chave)) {
      ignoradas.push(trimmed);
      continue;
    }
    chavesExistentes.add(parsed.chave);
    paraAdicionar.push(trimmed);
  }

  if (paraAdicionar.length > 0) {
    const atual = fs.readFileSync(caminho, "utf8");
    const precisaQuebra = atual.length > 0 && !atual.endsWith("\n");
    const bloco = (precisaQuebra ? "\n" : "") + paraAdicionar.join("\n") + "\n";
    fs.appendFileSync(caminho, bloco, "utf8");
  }

  return {
    caminho,
    adicionadas: paraAdicionar,
    ignoradas,
    total: existentes.length + paraAdicionar.length,
  };
}

function lerSessoes() {
  const dados = lerJsonSeguro(SESSOES_PATH, { contas: {} });
  if (!dados || typeof dados !== "object" || !dados.contas) {
    return { contas: {} };
  }
  return dados;
}

function obterSessaoConta(conta) {
  const db = lerSessoes();
  if (db.contas[conta.chave]) return db.contas[conta.chave];

  for (const item of Object.values(db.contas)) {
    if (!item || typeof item !== "object") continue;
    if (
      conta.email &&
      item.email &&
      item.email.toLowerCase() === conta.email.toLowerCase()
    ) {
      return item;
    }
    if (
      conta.customerId &&
      item.customerId &&
      item.customerId === conta.customerId
    ) {
      return item;
    }
  }
  return null;
}

function salvarSessaoConta(chave, patch) {
  const db = lerSessoes();
  const bruto = String(chave || patch?.email || patch?.customerId || "").trim();
  if (!bruto) return null;
  const key = bruto.includes("@") ? bruto.toLowerCase() : bruto;

  const anterior = db.contas[key] || {};
  db.contas[key] = {
    ...anterior,
    ...patch,
    atualizadoEm: new Date().toISOString(),
  };
  salvarJsonSeguro(SESSOES_PATH, db);
  return db.contas[key];
}

module.exports = {
  BASE_DIR,
  CONTAS_TXT_PATH,
  CONTAS_EXAMPLE_PATH,
  DADOS_DIR,
  SESSOES_PATH,
  resolverCaminhoContas,
  parseContaLinha,
  lerContasTxt,
  adicionarContasTxt,
  lerSessoes,
  obterSessaoConta,
  salvarSessaoConta,
};
