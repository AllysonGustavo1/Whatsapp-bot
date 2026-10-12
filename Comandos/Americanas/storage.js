"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "dados");
const CONTAS_FILE = path.join(DATA_DIR, "contas.json");
const PERFIS_FILE = path.join(DATA_DIR, "perfis.json");

function garantirDiretorio() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function carregarTodasContas() {
  garantirDiretorio();
  if (!fs.existsSync(CONTAS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(CONTAS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[Americanas Storage] Erro ao carregar contas.json:", err.message);
    return [];
  }
}

function salvarTodasContas(contas) {
  garantirDiretorio();
  fs.writeFileSync(CONTAS_FILE, JSON.stringify(contas, null, 2), "utf8");
}

function carregarTodosPerfis() {
  garantirDiretorio();
  if (!fs.existsSync(PERFIS_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(PERFIS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.error("[Americanas Storage] Erro ao carregar perfis.json:", err.message);
    return {};
  }
}

function salvarTodosPerfis(perfis) {
  garantirDiretorio();
  fs.writeFileSync(PERFIS_FILE, JSON.stringify(perfis, null, 2), "utf8");
}

/**
 * Normaliza o ID/telefone do usuário para isolamento estrito
 */
function normalizarUserId(id) {
  if (!id) return "desconhecido";
  return String(id).split("@")[0].split(":")[0].replace(/\D/g, "") || String(id);
}

/**
 * Retorna somente as contas pertencentes ao usuário informado
 */
function obterContasUsuario(ownerId) {
  const cleanOwner = normalizarUserId(ownerId);
  const todas = carregarTodasContas();
  return todas.filter((c) => normalizarUserId(c.ownerId) === cleanOwner);
}

/**
 * Salva ou atualiza uma conta vinculada ao usuário
 */
function salvarContaUsuario(ownerId, dadosConta) {
  const cleanOwner = normalizarUserId(ownerId);
  const todas = carregarTodasContas();

  const idx = todas.findIndex(
    (c) => normalizarUserId(c.ownerId) === cleanOwner && c.email.toLowerCase() === dadosConta.email.toLowerCase()
  );

  const registro = {
    ownerId: cleanOwner,
    email: dadosConta.email,
    password: dadosConta.password,
    userId: dadosConta.userId || null,
    profile: dadosConta.profile || null,
    mailPassword: dadosConta.mailPassword || null,
    criadoEm: dadosConta.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };

  if (idx >= 0) {
    todas[idx] = { ...todas[idx], ...registro };
  } else {
    todas.push(registro);
  }

  salvarTodasContas(todas);
  return registro;
}

/**
 * Remove contas de um usuário específico por lista de e-mails
 */
function removerContasUsuario(ownerId, emailsParaRemover = []) {
  const cleanOwner = normalizarUserId(ownerId);
  const setEmails = new Set(emailsParaRemover.map((e) => String(e).toLowerCase().trim()));
  const todas = carregarTodasContas();

  let removidas = 0;
  const novas = todas.filter((c) => {
    if (normalizarUserId(c.ownerId) === cleanOwner && setEmails.has(c.email.toLowerCase().trim())) {
      removidas++;
      return false;
    }
    return true;
  });

  if (removidas > 0) {
    salvarTodasContas(novas);
  }

  return removidas;
}

/**
 * Importa contas legadas de arquivos antigos para o primeiro usuário que interagir, caso não haja contas
 */
function importarContasLegadasSeNecessario(ownerId) {
  const cleanOwner = normalizarUserId(ownerId);
  const contasDoUsuario = obterContasUsuario(cleanOwner);
  if (contasDoUsuario.length > 0) return;

  const caminhosLegados = [
    path.resolve(__dirname, "../../../Americanas-get-pedidos/contas.txt"),
    path.resolve(__dirname, "../../../americanas-create-account/contas.txt"),
  ];

  for (const arq of caminhosLegados) {
    if (fs.existsSync(arq)) {
      try {
        const lines = fs.readFileSync(arq, "utf8").split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || !trimmed.includes(":")) continue;
          const [email, password] = trimmed.split(":");
          if (email && password) {
            salvarContaUsuario(cleanOwner, {
              email: email.trim(),
              password: password.trim(),
            });
          }
        }
        break; // importou o primeiro que encontrou
      } catch {
        // silencioso
      }
    }
  }
}

/**
 * Retorna o perfil configurado para o usuário especificado
 */
function obterPerfilUsuario(ownerId) {
  const cleanOwner = normalizarUserId(ownerId);
  const perfis = carregarTodosPerfis();
  return perfis[cleanOwner] || null;
}

/**
 * Salva ou atualiza campos do perfil padrão do usuário
 */
function salvarPerfilUsuario(ownerId, dadosNovos = {}) {
  const cleanOwner = normalizarUserId(ownerId);
  const perfis = carregarTodosPerfis();
  const existente = perfis[cleanOwner] || {};

  const atualizado = {
    ...existente,
    ...dadosNovos,
    atualizadoEm: new Date().toISOString(),
  };

  // Remove chaves nulas ou indefinidas
  for (const [k, v] of Object.entries(atualizado)) {
    if (v === null || v === undefined || v === "") {
      delete atualizado[k];
    }
  }

  perfis[cleanOwner] = atualizado;
  salvarTodosPerfis(perfis);
  return atualizado;
}

/**
 * Remove o perfil fixo do usuário (reset para dados aleatórios)
 */
function limparPerfilUsuario(ownerId) {
  const cleanOwner = normalizarUserId(ownerId);
  const perfis = carregarTodosPerfis();
  if (perfis[cleanOwner]) {
    delete perfis[cleanOwner];
    salvarTodosPerfis(perfis);
    return true;
  }
  return false;
}

module.exports = {
  obterContasUsuario,
  salvarContaUsuario,
  removerContasUsuario,
  importarContasLegadasSeNecessario,
  normalizarUserId,
  obterPerfilUsuario,
  salvarPerfilUsuario,
  limparPerfilUsuario,
};

