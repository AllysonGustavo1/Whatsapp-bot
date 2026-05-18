const fetchApi = globalThis.fetch || require("node-fetch");

async function extrairRespostaDetalhada(response) {
  const bodyText = await response
    .clone()
    .text()
    .catch(() => "");

  let data = null;
  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = null;
    }
  }

  const responseHeaders = {};
  response.headers.forEach((valor, chave) => {
    responseHeaders[chave] = valor;
  });

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    responseHeaders,
    bodyText,
    data,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  fetchApi,
  extrairRespostaDetalhada,
  sleep,
};
