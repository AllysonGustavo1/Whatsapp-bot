const { fetchApi } = require("../utils/http");

const URL_NOME_ALEATORIO = "https://gerador-nomes.wolan.net/nome/aleatorio";
const URL_MAILTM_DOMAINS = "https://api.mail.tm/domains";
const URL_MAILTM_ACCOUNTS = "https://api.mail.tm/accounts";

const DDD_VALIDOS_BR = [
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "21",
  "22",
  "24",
  "27",
  "28",
  "31",
  "32",
  "33",
  "34",
  "35",
  "37",
  "38",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "53",
  "54",
  "55",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "67",
  "68",
  "69",
  "71",
  "73",
  "74",
  "75",
  "77",
  "79",
  "81",
  "82",
  "83",
  "84",
  "85",
  "86",
  "87",
  "88",
  "89",
  "91",
  "92",
  "93",
  "94",
  "95",
  "96",
  "97",
  "98",
  "99",
];

function capitalizar(valor) {
  if (!valor || typeof valor !== "string") return "";
  const texto = valor.trim().toLowerCase();
  if (!texto) return "";
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function randomString(tamanho = 10) {
  const caracteres = "abcdefghijklmnopqrstuvwxyz0123456789";
  let resultado = "";
  for (let i = 0; i < tamanho; i++) {
    resultado += caracteres.charAt(
      Math.floor(Math.random() * caracteres.length),
    );
  }
  return resultado;
}

function gerarCPF() {
  const cpf = [];
  for (let i = 0; i < 9; i++) {
    cpf.push(Math.floor(Math.random() * 10));
  }

  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += cpf[i] * (10 - i);
  }

  let resto = soma % 11;
  const digito1 = resto < 2 ? 0 : 11 - resto;
  cpf.push(digito1);

  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += cpf[i] * (11 - i);
  }

  resto = soma % 11;
  const digito2 = resto < 2 ? 0 : 11 - resto;
  cpf.push(digito2);

  return cpf.join("");
}

async function gerarNomeAleatorio() {
  const response = await fetchApi(URL_NOME_ALEATORIO, { method: "GET" });
  const data = await response.json();

  if (!Array.isArray(data) || data.length < 2) {
    throw new Error("Não foi possível gerar nome aleatório.");
  }

  const primeiro = capitalizar(String(data[0] || ""));
  const segundo = capitalizar(String(data[1] || ""));
  const nome = `${primeiro} ${segundo}`.trim();

  if (!nome) throw new Error("Nome aleatório inválido recebido da API.");
  return nome;
}

function gerarTelefoneAleatorio() {
  const ddd = DDD_VALIDOS_BR[Math.floor(Math.random() * DDD_VALIDOS_BR.length)];
  const numero = Math.floor(Math.random() * 100000000)
    .toString()
    .padStart(8, "0");
  return `${ddd}9${numero}`;
}

async function gerarEmailMailTm({ senha = "Zelele123@" } = {}) {
  const domainsResponse = await fetchApi(URL_MAILTM_DOMAINS, { method: "GET" });
  const domainsData = await domainsResponse.json();
  const domains = domainsData?.["hydra:member"] || [];

  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error("Não foi possível obter domínio da mail.tm.");
  }

  const domain = domains[0]?.domain;
  if (!domain) throw new Error("Domínio inválido da mail.tm.");

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const address = `${randomString(12)}@${domain}`;
    const body = { address, password: senha };

    const response = await fetchApi(URL_MAILTM_ACCOUNTS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return { email: address, senhaMailbox: senha };
    }
  }

  throw new Error(
    "Não foi possível criar e-mail na mail.tm após múltiplas tentativas.",
  );
}

module.exports = {
  gerarCPF,
  gerarNomeAleatorio,
  gerarTelefoneAleatorio,
  gerarEmailMailTm,
};
