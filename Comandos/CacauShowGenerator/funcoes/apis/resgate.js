const { fetchApi, extrairRespostaDetalhada } = require("../utils/http");
const { normalizarBearer } = require("../utils/token");

const URL_RESGATE_EXPERIENCIA_BASE =
  "https://apigatewaysitelovers.cacaushow.com.br/experienciasite/api/experiencias";
const URL_LISTAR_MEUS_RESGATES =
  "https://apigatewaysitelovers.cacaushow.com.br/experienciasite/api/experiencias/listar-meus-resgates";
const URL_OBTER_DESTAQUES =
  "https://apigatewaysitelovers.cacaushow.com.br/experienciasite/api/categorias/obter-destaques-com-experiencias-ativas";
const URL_OBTER_SEM_DESTAQUES =
  "https://apigatewaysitelovers.cacaushow.com.br/experienciasite/api/experiencias/obter-ativas-sem-destaques";

const DEFAULT_EXPERIENCIA_ID = 5698;
const DEFAULT_OFERTA_ID = 11849;

let cachedExperienciaConfig = null;

function gerarIdempotenceKey() {
  const parte = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${parte()}${parte()}-${parte()}-${parte()}-${parte()}-${parte()}${parte()}${parte()}`;
}

async function buscarExperienciasAtivas({ apiHeaders, token }) {
  const headers = {
    ...apiHeaders,
    authorization: `Bearer ${normalizarBearer(token)}`,
  };

  const [resDestaques, resSemDestaques] = await Promise.all([
    fetchApi(URL_OBTER_DESTAQUES, { method: "GET", headers }).then(
      extrairRespostaDetalhada
    ),
    fetchApi(URL_OBTER_SEM_DESTAQUES, { method: "GET", headers }).then(
      extrairRespostaDetalhada
    ),
  ]);

  const lista = [];
  if (Array.isArray(resDestaques?.data)) {
    for (const cat of resDestaques.data) {
      if (Array.isArray(cat?.experiencias)) {
        lista.push(...cat.experiencias);
      }
    }
  }

  if (Array.isArray(resSemDestaques?.data)) {
    lista.push(...resSemDestaques.data);
  }

  return lista;
}

async function obterLotesExperiencia({ apiHeaders, token, slug }) {
  if (!slug) return [];
  const url = `${URL_RESGATE_EXPERIENCIA_BASE}/obter-por-nome-identificador/${encodeURIComponent(
    slug
  )}/lotes`;
  const res = await fetchApi(url, {
    method: "GET",
    headers: {
      ...apiHeaders,
      authorization: `Bearer ${normalizarBearer(token)}`,
    },
  });
  const detalhes = await extrairRespostaDetalhada(res);
  return Array.isArray(detalhes?.data) ? detalhes.data : [];
}

async function encontrarExperienciaTrufa({
  apiHeaders,
  token,
  forcarAtualizacao = false,
}) {
  if (
    !forcarAtualizacao &&
    cachedExperienciaConfig &&
    Date.now() - cachedExperienciaConfig.timestamp < 1000 * 60 * 60
  ) {
    return cachedExperienciaConfig;
  }

  try {
    const experiencias = await buscarExperienciasAtivas({ apiHeaders, token });

    const ehAniversarioSilver = (e) =>
      e?.usuarioPertenceAoNivelDaExperiencia !== false &&
      /anivers[aá]rio/i.test(e?.nome || "") &&
      /silver/i.test(e?.nome || "");

    const ehAniversarioZeroCacaus = (e) =>
      e?.usuarioPertenceAoNivelDaExperiencia !== false &&
      /anivers[aá]rio/i.test(e?.nome || "") &&
      (e?.cacaus === 0 || e?.valorPagamento === 0);

    const ehTrufaZeroCacaus = (e) =>
      e?.usuarioPertenceAoNivelDaExperiencia !== false &&
      /trufa/i.test(e?.nome || "") &&
      (e?.cacaus === 0 || e?.valorPagamento === 0);

    const match =
      experiencias.find(ehAniversarioSilver) ||
      experiencias.find(ehAniversarioZeroCacaus) ||
      experiencias.find(ehTrufaZeroCacaus) ||
      experiencias.find(
        (e) =>
          /anivers[aá]rio/i.test(e?.nome || "") &&
          /silver/i.test(e?.nome || "")
      ) ||
      null;

    if (!match) {
      console.warn(
        `[CacauShow] Nenhuma experiência de aniversário/trufa encontrada nas ativas. Usando ID padrão (${DEFAULT_EXPERIENCIA_ID}).`
      );
      return {
        experienciaId: DEFAULT_EXPERIENCIA_ID,
        ofertaId: DEFAULT_OFERTA_ID,
        nome: "Aniversário - Silver (Padrão)",
      };
    }

    let ofertaId = DEFAULT_OFERTA_ID;
    if (match.nomeIdentificador) {
      const lotes = await obterLotesExperiencia({
        apiHeaders,
        token,
        slug: match.nomeIdentificador,
      });

      const loteValido =
        lotes.find((l) => l?.cacaus === 0 || l?.valorPagamento === 0) ||
        lotes.find((l) => l?.loteIlimitado || (l?.quantidadeDisponivel || 0) > 0) ||
        lotes[0];

      if (loteValido?.loteId) {
        ofertaId = loteValido.loteId;
      }
    }

    const resultado = {
      experienciaId: match.experienciaId,
      ofertaId,
      nome: match.nome,
      slug: match.nomeIdentificador,
      timestamp: Date.now(),
    };

    console.log(
      `[CacauShow] Experiência identificada dinamicamente: ${resultado.experienciaId} ("${resultado.nome}") | Oferta/Lote: ${resultado.ofertaId}`
    );

    cachedExperienciaConfig = resultado;
    return resultado;
  } catch (err) {
    console.warn(
      `[CacauShow] Falha ao descobrir experiência dinamicamente: ${err.message}. Usando ID padrão (${DEFAULT_EXPERIENCIA_ID}).`
    );
    return {
      experienciaId: DEFAULT_EXPERIENCIA_ID,
      ofertaId: DEFAULT_OFERTA_ID,
      nome: "Aniversário - Silver (Fallback)",
    };
  }
}

async function resgatarTrufa({
  apiHeaders,
  token,
  experienciaId,
  ofertaId,
  quantidade = 1,
  parceiroEnderecoId = null,
  acompanhantes = [],
  idempotenceKey,
}) {
  let expId = experienciaId;
  let ofId = ofertaId;

  if (!expId || !ofId) {
    const dinamico = await encontrarExperienciaTrufa({ apiHeaders, token });
    expId = expId || dinamico.experienciaId;
    ofId = ofId || dinamico.ofertaId;
  }

  const url = `${URL_RESGATE_EXPERIENCIA_BASE}/${expId}/resgatar/${ofId}`;
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
    experienciaId: expId,
    ofertaId: ofId,
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
  experienciaId = null,
  ofertaId = null,
  pagina = 1,
  quantidade = 1,
  parceiroEnderecoId = null,
  acompanhantes = [],
  idempotenceKey,
}) {
  let resgate = await resgatarTrufa({
    apiHeaders,
    token,
    experienciaId,
    ofertaId,
    quantidade,
    parceiroEnderecoId,
    acompanhantes,
    idempotenceKey,
  });

  // Se retornou 404 (experiência ou oferta não encontrada), invalida cache e tenta redescobrir
  if (resgate.status === 404) {
    console.warn(
      `[CacauShow] Resgate retornou 404 para Experiencia ${resgate.experienciaId} / Oferta ${resgate.ofertaId}. Tentando atualizar IDs dinamicamente...`
    );
    const novo = await encontrarExperienciaTrufa({
      apiHeaders,
      token,
      forcarAtualizacao: true,
    });

    if (
      novo.experienciaId !== resgate.experienciaId ||
      novo.ofertaId !== resgate.ofertaId
    ) {
      console.log(
        `[CacauShow] Tentando novo resgate com Experiencia ${novo.experienciaId} e Oferta ${novo.ofertaId}...`
      );
      resgate = await resgatarTrufa({
        apiHeaders,
        token,
        experienciaId: novo.experienciaId,
        ofertaId: novo.ofertaId,
        quantidade,
        parceiroEnderecoId,
        acompanhantes,
      });
    }
  }

  const meusResgates = await listarMeusResgates({
    apiHeaders,
    token,
    pagina,
  });

  return {
    resgate,
    meusResgates,
    experienciaId: resgate.experienciaId,
    ofertaId: resgate.ofertaId,
    ...obterExperienciaMembroIdEValidade(meusResgates),
  };
}

module.exports = {
  resgatarTrufa,
  listarMeusResgates,
  obterExperienciaMembroIdEValidade,
  fluxoResgateTrufa,
  buscarExperienciasAtivas,
  obterLotesExperiencia,
  encontrarExperienciaTrufa,
};
