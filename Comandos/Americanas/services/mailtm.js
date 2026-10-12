"use strict";

const https = require("https");
const zlib = require("zlib");
const { randomAlphanumeric } = require("../utils/generators");

const BASE_URL = process.env.MAILTM_BASE_URL || "https://api.mail.tm";
const URL_DOMAINS = `${BASE_URL}/domains`;
const URL_ACCOUNTS = `${BASE_URL}/accounts`;
const URL_TOKEN = `${BASE_URL}/token`;
const URL_MESSAGES = `${BASE_URL}/messages`;
const DEFAULT_MAIL_PASSWORD = process.env.AMERICANAS_DEFAULT_MAIL_PASSWORD || "AmericanasMail123!";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpJsonRequest(url, options = {}, payload = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyBuf = payload
      ? Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))
      : null;

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate, br",
      ...(options.headers || {})
    };

    if (bodyBuf) {
      headers["Content-Length"] = String(bodyBuf.length);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || (bodyBuf ? "POST" : "GET"),
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const enc = res.headers["content-encoding"];

          const finish = (decompressed) => {
            const rawText = decompressed.toString("utf8");
            let data = null;
            try {
              data = JSON.parse(rawText);
            } catch {
              data = rawText;
            }

            resolve({
              status: res.statusCode || 0,
              ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
              headers: res.headers || {},
              data,
              raw: rawText
            });
          };

          if (enc === "gzip") {
            zlib.gunzip(buf, (err, dec) => (err ? finish(buf) : finish(dec)));
          } else if (enc === "br") {
            zlib.brotliDecompress(buf, (err, dec) => (err ? finish(buf) : finish(dec)));
          } else {
            finish(buf);
          }
        });
      }
    );

    req.on("error", reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function obterDominioDisponivel() {
  const res = await httpJsonRequest(URL_DOMAINS);
  if (!res.ok) {
    throw new Error(`Falha ao obter domínios do Mail.tm (HTTP ${res.status}): ${res.raw}`);
  }

  const list = res.data?.["hydra:member"] || res.data || [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("Nenhum domínio disponível retornado pelo Mail.tm.");
  }

  const activeDomains = list.filter((d) => d.isActive !== false);
  const selected = (activeDomains.length > 0 ? activeDomains[0] : list[0])?.domain;
  if (!selected) {
    throw new Error("Domínio inválido retornado pelo Mail.tm.");
  }

  return selected;
}

async function criarContaMailTm({ email, senha, maxRetries = 4, delayBaseMs = 2500 }) {
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await httpJsonRequest(
      URL_ACCOUNTS,
      { method: "POST" },
      { address: email, password: senha }
    );

    if (res.ok) {
      return res.data;
    }

    if (res.status === 429) {
      const wait = delayBaseMs * tentativa;
      await sleep(wait);
      continue;
    }

    throw new Error(`Erro ao criar conta no Mail.tm (${res.status}): ${res.raw}`);
  }

  throw new Error(`Limite de taxa atingido no Mail.tm após ${maxRetries} tentativas.`);
}

async function autenticarMailTm({ email, senha, maxRetries = 3 }) {
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await httpJsonRequest(
      URL_TOKEN,
      { method: "POST" },
      { address: email, password: senha }
    );

    if (res.ok && res.data?.token) {
      return res.data.token;
    }

    if (res.status === 429) {
      await sleep(2000 * tentativa);
      continue;
    }

    throw new Error(`Falha ao autenticar no Mail.tm (${res.status}): ${res.raw}`);
  }

  throw new Error("Não foi possível autenticar no Mail.tm.");
}

async function listarMensagens({ token }) {
  const res = await httpJsonRequest(URL_MESSAGES, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Falha ao listar mensagens do Mail.tm (${res.status})`);
  }

  const list = res.data?.["hydra:member"] || res.data?.messages || res.data || [];
  return Array.isArray(list) ? list : [];
}

async function obterDetalheMensagem({ token, id }) {
  const res = await httpJsonRequest(`${URL_MESSAGES}/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Falha ao obter detalhe da mensagem (${res.status})`);
  }

  return res.data;
}

function extrairCodigoAcesso(texto) {
  if (!texto || typeof texto !== "string") return null;
  const match = texto.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

async function aguardarCodigoAmericanas({
  email,
  senha,
  token = null,
  timeoutMs = 90000,
  intervaloMs = 2500,
  onTick = null
}) {
  const mailToken = token || (await autenticarMailTm({ email, senha }));
  const startTime = Date.now();
  let tentativa = 0;

  while (Date.now() - startTime < timeoutMs) {
    tentativa += 1;
    if (typeof onTick === "function") {
      onTick({ tentativa, elapsedMs: Date.now() - startTime });
    }

    try {
      const mensagens = await listarMensagens({ token: mailToken });

      for (const msg of mensagens) {
        const codigoSubject = extrairCodigoAcesso(msg.subject);
        if (codigoSubject) return { codigo: codigoSubject, message: msg };

        const codigoIntro = extrairCodigoAcesso(msg.intro);
        if (codigoIntro) return { codigo: codigoIntro, message: msg };

        if (msg.id) {
          const detalhe = await obterDetalheMensagem({ token: mailToken, id: msg.id });
          const text = detalhe.text || "";
          const html = Array.isArray(detalhe.html)
            ? detalhe.html.join(" ")
            : detalhe.html || "";
          const fullContent = `${detalhe.subject || ""} ${text} ${html}`;
          const codigo = extrairCodigoAcesso(fullContent);
          if (codigo) {
            return { codigo, message: detalhe };
          }
        }
      }
    } catch {
      // Ignora erro momentâneo de requisição
    }

    await sleep(intervaloMs);
  }

  throw new Error(`Código de verificação da Americanas não chegou em ${timeoutMs / 1000}s.`);
}

async function criarEmailTemporario({ senha = null, prefixo = "ame" } = {}) {
  const domain = await obterDominioDisponivel();
  const randUser = `${prefixo}${randomAlphanumeric(9)}`;
  const email = `${randUser}@${domain}`;
  const senhaMailbox = senha || DEFAULT_MAIL_PASSWORD;

  await criarContaMailTm({ email, senha: senhaMailbox });
  const token = await autenticarMailTm({ email, senha: senhaMailbox });

  return {
    email,
    senhaMailbox,
    domain,
    token
  };
}

module.exports = {
  DEFAULT_MAIL_PASSWORD,
  obterDominioDisponivel,
  criarContaMailTm,
  autenticarMailTm,
  listarMensagens,
  obterDetalheMensagem,
  extrairCodigoAcesso,
  aguardarCodigoAmericanas,
  criarEmailTemporario
};
