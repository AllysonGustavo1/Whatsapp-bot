const { fetchApi, extrairRespostaDetalhada } = require("../utils/http");
const { normalizarBearer } = require("../utils/token");

const URL_RESGATE_EXPERIENCIA_BASE =
  "https://apigatewaysitelovers.cacaushow.com.br/experienciasite/api/experiencias";
const URL_LISTAR_MEUS_RESGATES =
  "https://apigatewaysitelovers.cacaushow.com.br/experienciasite/api/experiencias/listar-meus-resgates";

function gerarIdempotenceKey() {
  const parte = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${parte()}${parte()}-${parte()}-${parte()}-${parte()}-${parte()}${parte()}${parte()}`;
}

async function resgatarTrufa({
  apiHeaders,
  token,
  experienciaId = 2011,
  ofertaId = 8265,
  quantidade = 1,
  parceiroEnderecoId = null,
  acompanhantes = [],
  idempotenceKey,
}) {
  const url = `${URL_RESGATE_EXPERIENCIA_BASE}/${experienciaId}/resgatar/${ofertaId}`;
  const body = { quantidade, parceiroEnderecoId, acompanhantes };
  const headers = {
    ...apiHeaders,
    authorization: `Bearer ${normalizarBearer(token)}`,
    "content-type": "application/json",
    "idempotence-key": idempotenceKey || gerarIdempotenceKey(),
  };

  const response = await fetchApi(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return {
    response,
    url,
    requestBody: body,
    ...(await extrairRespostaDetalhada(response)),
  };
}

async function listarMeusResgates({ apiHeaders, token, pagina = 1 }) {
  const url = `${URL_LISTAR_MEUS_RESGATES}?pagina=${pagina}`;
  const headers = {
    ...apiHeaders,
    authorization: `Bearer ${normalizarBearer(token)}`,
  };

  const response = await fetchApi(url, {
    method: "GET",
    headers,
  });

  return {
    response,
    url,
    requestBody: null,
    ...(await extrairRespostaDetalhada(response)),
  };
}

function obterExperienciaMembroIdEValidade(listaResgates) {
  const item = listaResgates?.data?.items?.[0] || null;
  return {
    experienciaMembroId: item?.experienciaMembroId || null,
    validade: item?.validade || null,
  };
}

async function fluxoResgateTrufa({
  apiHeaders,
  token,
  experienciaId = 2011,
  ofertaId = 8265,
  pagina = 1,
  quantidade = 1,
  parceiroEnderecoId = null,
  acompanhantes = [],
  idempotenceKey,
}) {
  const resgate = await resgatarTrufa({
    apiHeaders,
    token,
    experienciaId,
    ofertaId,
    quantidade,
    parceiroEnderecoId,
    acompanhantes,
    idempotenceKey,
  });

  const meusResgates = await listarMeusResgates({
    apiHeaders,
    token,
    pagina,
  });

  return {
    resgate,
    meusResgates,
    ...obterExperienciaMembroIdEValidade(meusResgates),
  };
}

module.exports = {
  resgatarTrufa,
  listarMeusResgates,
  obterExperienciaMembroIdEValidade,
  fluxoResgateTrufa,
};
