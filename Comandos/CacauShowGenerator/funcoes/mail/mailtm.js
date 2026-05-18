const { fetchApi, sleep } = require("../utils/http");

const URL_MAILTM_TOKEN = "https://api.mail.tm/token";
const URL_MAILTM_MESSAGES = "https://api.mail.tm/messages";

async function autenticarMailTm({ email, senha }) {
  const response = await fetchApi(URL_MAILTM_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: email, password: senha }),
  });

  if (!response.ok) {
    throw new Error("Falha ao autenticar no mail.tm.");
  }

  const data = await response.json();
  if (!data?.token) throw new Error("Token do mail.tm não retornado.");
  return data.token;
}

async function listarMensagensMailTm({ mailToken }) {
  const response = await fetchApi(URL_MAILTM_MESSAGES, {
    method: "GET",
    headers: {
      authorization: `Bearer ${mailToken}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Falha ao listar mensagens do mail.tm.");
  }

  const data = await response.json();

  const mensagens = Array.isArray(data)
    ? data
    : data?.["hydra:member"] || data?.items || data?.messages || [];

  return {
    mensagens: Array.isArray(mensagens) ? mensagens : [],
    raw: data,
  };
}

async function obterMensagemMailTm({ mailToken, id }) {
  const response = await fetchApi(`${URL_MAILTM_MESSAGES}/${id}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${mailToken}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Falha ao obter mensagem do mail.tm.");
  }

  return response.json();
}

function extrairCodigoDoTexto(texto) {
  if (!texto || typeof texto !== "string") return null;
  const match = texto.match(/\b(\d{4,8})\b/);
  return match ? match[1] : null;
}

async function aguardarCodigoEmailMailTm({
  email,
  senha,
  timeoutMs = 600000,
  intervaloMs = 5000,
  onTentativa,
}) {
  const mailToken = await autenticarMailTm({ email, senha });
  const inicio = Date.now();
  let tentativa = 0;

  while (Date.now() - inicio < timeoutMs) {
    tentativa += 1;
    const inbox = await listarMensagensMailTm({ mailToken });
    const mensagens = inbox.mensagens;
    const mensagensDetalhes = [];

    for (const msg of mensagens) {
      const codigoIntro = extrairCodigoDoTexto(msg?.intro);
      const codigoSubject = extrairCodigoDoTexto(msg?.subject);
      const codigoTextPreview = extrairCodigoDoTexto(msg?.text);

      if (codigoSubject) return codigoSubject;
      if (codigoIntro) return codigoIntro;
      if (codigoTextPreview) return codigoTextPreview;

      if (msg?.id) {
        const detalhe = await obterMensagemMailTm({ mailToken, id: msg.id });
        mensagensDetalhes.push(detalhe);
        const codigoText = extrairCodigoDoTexto(detalhe?.text);
        const codigoHtml = extrairCodigoDoTexto(
          Array.isArray(detalhe?.html)
            ? detalhe.html.join(" ")
            : String(detalhe?.html || ""),
        );
        const codigoSubjectDetalhe = extrairCodigoDoTexto(detalhe?.subject);
        if (codigoText || codigoHtml) return codigoText || codigoHtml;
        if (codigoSubjectDetalhe) return codigoSubjectDetalhe;
      }
    }

    if (typeof onTentativa === "function") {
      onTentativa({
        tentativa,
        mensagens,
        inboxRaw: inbox.raw,
        mensagensDetalhes,
        elapsedMs: Date.now() - inicio,
      });
    }

    await sleep(intervaloMs);
  }

  throw new Error(
    "Código de validação não chegou no mail.tm dentro do tempo limite.",
  );
}

module.exports = {
  aguardarCodigoEmailMailTm,
};
