const fs = require("fs");
const path = require("path");

const API_BASE = "https://acao-de-fluxo-api.prd.consumidor.grupoboticario.digital";
const CONFIG_FILE = path.join(process.cwd(), "comandos-config.json");
const FALLBACK_CAMPAIGN = "floratta-blue-crystal-14-2026";

async function validarCampanha(campaignId) {
  if (!campaignId) return { valida: false };

  try {
    const url = `${API_BASE}/campaign/${campaignId}/consumerEntryPoint`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "x-channel-source": "app",
        Origin: "https://campanha.boticario.com.br",
      },
    });

    if (!res.ok) {
      return { valida: false, statusHttp: res.status };
    }

    const json = await res.json();
    const dados = json?.data?.[0];
    const status = dados?.campaignStatus;

    return {
      valida: status === "enabled",
      status: status || "unknown",
      title: dados?.title || campaignId,
      initialDate: dados?.initialDateHotSite,
      finalDate: dados?.finalDateHotSite,
    };
  } catch (err) {
    return { valida: false, erro: err.message };
  }
}

function extrairSlugCampanha(texto = "") {
  const matchUrl = texto.match(/campanha\.boticario\.com\.br\/([a-zA-Z0-9_\-]+)/i);
  if (matchUrl && matchUrl[1]) {
    return matchUrl[1].toLowerCase();
  }

  const matchSlug = texto.match(/[a-z0-9-]+-(?:0[1-9]|1[0-9])-202[0-9]/i);
  if (matchSlug) {
    return matchSlug[0].toLowerCase();
  }

  const limpo = texto.trim().toLowerCase();
  if (limpo && !limpo.includes(" ") && !limpo.includes("/")) {
    return limpo;
  }

  return null;
}

async function buscarCandidatosWeb() {
  const candidatos = new Set();

  const urlsDeBusca = [
    "https://html.duckduckgo.com/html/?q=site:campanha.boticario.com.br",
    "https://html.duckduckgo.com/html/?q=campanha.boticario.com.br+brinde",
    "https://news.google.com/rss/search?q=campanha+boticario+brinde&hl=pt-BR&gl=BR&ceid=BR:pt-419",
  ];

  for (const url of urlsDeBusca) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (res.ok) {
        const text = await res.text();
        const matches = text.match(/[a-z0-9-]+-(?:0[1-9]|1[0-9])-202[0-9]/gi) || [];
        matches.forEach((m) => candidatos.add(m.toLowerCase()));
      }
    } catch {
      // Ignora erro em fontes externas
    }
  }

  return Array.from(candidatos);
}

function getCampanhaSalva() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return config?.boticariomimo?.campanha || null;
    }
  } catch {
    // silencioso
  }
  return null;
}

function salvarCampanhaConfig(campanhaId) {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      if (!config.boticariomimo) {
        config.boticariomimo = {};
      }
      config.boticariomimo.campanha = campanhaId;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
      return true;
    }
  } catch (err) {
    console.error("[BOTICÁRIO CAMPANHA] Erro ao salvar campanha:", err.message);
  }
  return false;
}

let cacheCampanhaAtiva = null;
let cacheExpiraEm = 0;

async function obterCampanhaAtiva({ forcarAtualizacao = false } = {}) {
  const agora = Date.now();
  if (!forcarAtualizacao && cacheCampanhaAtiva && agora < cacheExpiraEm) {
    return cacheCampanhaAtiva;
  }

  // 1. Tenta a campanha salva no comandos-config.json
  const campanhaConfig = getCampanhaSalva();
  if (campanhaConfig) {
    const checagem = await validarCampanha(campanhaConfig);
    if (checagem.valida) {
      cacheCampanhaAtiva = campanhaConfig;
      cacheExpiraEm = agora + 30 * 60 * 1000; // cache de 30 min
      return campanhaConfig;
    }
    console.log(
      `[BOTICÁRIO CAMPANHA] Campanha salva "${campanhaConfig}" está ${checagem.status}. Buscando nova campanha ativa...`
    );
  }

  // 2. Tenta o fallback conhecido
  const checagemFallback = await validarCampanha(FALLBACK_CAMPAIGN);
  if (checagemFallback.valida) {
    salvarCampanhaConfig(FALLBACK_CAMPAIGN);
    cacheCampanhaAtiva = FALLBACK_CAMPAIGN;
    cacheExpiraEm = agora + 30 * 60 * 1000;
    return FALLBACK_CAMPAIGN;
  }

  // 3. Tenta descoberta automática na web
  console.log("[BOTICÁRIO CAMPANHA] Buscando nova campanha ativa na web...");
  const candidatos = await buscarCandidatosWeb();
  for (const cand of candidatos) {
    const val = await validarCampanha(cand);
    if (val.valida) {
      console.log(`[BOTICÁRIO CAMPANHA] Nova campanha ativa encontrada: ${cand}`);
      salvarCampanhaConfig(cand);
      cacheCampanhaAtiva = cand;
      cacheExpiraEm = agora + 30 * 60 * 1000;
      return cand;
    }
  }

  // Se nada responder, usa o fallback
  return FALLBACK_CAMPAIGN;
}

let agendadorIniciado = false;

function iniciarAgendadorDiarioCampanha(callback = null) {
  if (agendadorIniciado) {
    return;
  }
  agendadorIniciado = true;

  function agendar() {
    const agora = new Date();
    const proximaExecucao = new Date(agora);
    proximaExecucao.setHours(0, 1, 0, 0); // 00:01:00.000

    // Se já passou de 00:01 hoje, agenda para o dia seguinte
    if (agora >= proximaExecucao) {
      proximaExecucao.setDate(proximaExecucao.getDate() + 1);
    }

    const msAteProxima = proximaExecucao.getTime() - agora.getTime();
    console.log(
      `[BOTICÁRIO CAMPANHA] Próxima busca automática de campanha agendada para: ${proximaExecucao.toLocaleString("pt-BR")}`
    );

    setTimeout(async () => {
      console.log(
        "[BOTICÁRIO CAMPANHA] ⏰ 00:01 - Executando checagem automática diária por novas campanhas..."
      );
      try {
        const campanhaAntiga = getCampanhaSalva();
        const novaCampanha = await obterCampanhaAtiva({
          forcarAtualizacao: true,
        });

        if (novaCampanha !== campanhaAntiga) {
          console.log(
            `[BOTICÁRIO CAMPANHA] 🎉 Nova campanha detectada na rotina das 00:01: ${novaCampanha} (anterior: ${campanhaAntiga})`
          );
          if (typeof callback === "function") {
            await callback({ novaCampanha, campanhaAntiga });
          }
        } else {
          console.log(
            `[BOTICÁRIO CAMPANHA] Campanha diária verificada: ${novaCampanha} segue ativa.`
          );
        }
      } catch (err) {
        console.error(
          "[BOTICÁRIO CAMPANHA] Erro na rotina diária das 00:01:",
          err.message
        );
      } finally {
        agendar(); // reagenda para 00:01 do próximo dia
      }
    }, msAteProxima);
  }

  agendar();
}

module.exports = {
  validarCampanha,
  extrairSlugCampanha,
  obterCampanhaAtiva,
  salvarCampanhaConfig,
  iniciarAgendadorDiarioCampanha,
  FALLBACK_CAMPAIGN,
};
