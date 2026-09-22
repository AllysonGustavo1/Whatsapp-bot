const fs = require("fs");
const path = require("path");
const {
  obterCampanhaAtiva,
  validarCampanha,
  extrairSlugCampanha,
  salvarCampanhaConfig,
  iniciarAgendadorDiarioCampanha,
  FALLBACK_CAMPAIGN,
} = require("./campanha");

const API_BASE = "https://acao-de-fluxo-api.prd.consumidor.grupoboticario.digital";
const CAMPAIGN_ID_DEFAULT = FALLBACK_CAMPAIGN;
const CONSUMER_CPF_DEFAULT = "04674914965";
const CONSUMER_BIRTHDAY_DEFAULT = "1950-03-10";

// Token padrão de fallback
const INITIAL_TOKEN = "";

function getHeaders(token = "") {
  const headers = {
    Host: "acao-de-fluxo-api.prd.consumidor.grupoboticario.digital",
    Connection: "keep-alive",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    "sec-ch-ua-platform": '"Android"',
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 9; A5010 Build/PI; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.179 Mobile Safari/537.36",
    "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Android WebView";v="138"',
    "sec-ch-ua-mobile": "?1",
    "x-channel-source": "app",
    Accept: "*/*",
    Origin: "https://campanha.boticario.com.br",
    "X-Requested-With": "com.boticario.mobile",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    Referer: "https://campanha.boticario.com.br/",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

async function identificarConsumidor({
  campaignId = CAMPAIGN_ID_DEFAULT,
  consumerCpf = CONSUMER_CPF_DEFAULT,
  consumerBirthday = CONSUMER_BIRTHDAY_DEFAULT,
  bearerToken = INITIAL_TOKEN,
} = {}) {
  const url = `${API_BASE}/campaign/${campaignId}/consumer/identify`;
  const headers = {
    ...getHeaders(bearerToken),
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ consumerCpf, consumerBirthday }),
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(
      `Falha na identificação do consumidor: ${json.message || response.statusText}`
    );
  }

  const consumidor = json.data?.[0];
  return {
    accessToken: consumidor?.accessToken || bearerToken,
    refreshToken: consumidor?.refreshToken,
    consumidor,
  };
}

async function vincularCanalLoja({
  campaignId = CAMPAIGN_ID_DEFAULT,
  consumerCpf = CONSUMER_CPF_DEFAULT,
  token,
} = {}) {
  const url = `${API_BASE}/campaign/${campaignId}/consumer/${consumerCpf}/channel/store`;
  const headers = getHeaders(token);

  const response = await fetch(url, {
    method: "POST",
    headers,
  });

  const json = await response.json();
  return json;
}

async function buscarLojasPorTexto({
  campaignId = CAMPAIGN_ID_DEFAULT,
  consumerCpf = CONSUMER_CPF_DEFAULT,
  cidade = "Natal",
  token,
} = {}) {
  const url = `${API_BASE}/campaign/${campaignId}/stores/searchByText?searchText=${encodeURIComponent(
    cidade
  )}&consumerCpf=${consumerCpf}`;
  const headers = getHeaders(token);

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(
      `Falha ao buscar lojas: ${json.message || response.statusText}`
    );
  }

  return json.data || [];
}

function formatarDataHora(date = new Date()) {
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function salvarLojasEmTxt({
  lojas = [],
  cidade = "Natal",
  campanha = CAMPAIGN_ID_DEFAULT,
  caminhoArquivo,
}) {
  const agora = formatarDataHora();
  const disponiveis = lojas.filter((l) => Boolean(l.availableSupply));
  const esgotadas = lojas.filter((l) => !l.availableSupply);

  const linhas = [
    "============================================================",
    "          RELATÓRIO DE DISPONIBILIDADE - O BOTICÁRIO        ",
    "============================================================",
    `Data da Consulta: ${agora}`,
    `Campanha: ${campanha}`,
    `Cidade Pesquisada: ${cidade}`,
    `Total de Lojas: ${lojas.length}`,
    `Lojas com Estoque Disponível: ${disponiveis.length}`,
    `Lojas Esgotadas: ${esgotadas.length}`,
    "============================================================",
    "",
  ];

  if (disponiveis.length > 0) {
    linhas.push("🟢 LOJAS COM MIMO DISPONÍVEL:");
    linhas.push("------------------------------------------------------------");
    disponiveis.forEach((loja, i) => {
      linhas.push(`[${i + 1}] ${loja.storeName || "Loja sem nome"}`);
      linhas.push(`    Código: ${loja.code}`);
      linhas.push(`    Endereço: ${loja.storeStreetAddress || ""}, ${loja.storeAddressNumber || "S/N"}${loja.storeAddressNumberComplement ? ` (${loja.storeAddressNumberComplement})` : ""}`);
      linhas.push(`    Bairro: ${loja.storeDistrict || ""} - ${loja.storeCity || ""}/${loja.storeState || ""}`);
      linhas.push(`    CEP: ${loja.storeZipCode || "N/A"}`);
      linhas.push(`    Status Operacional: ${loja.operationStatus || "N/A"}`);
      linhas.push(`    Disponível: SIM (${loja.availableSupply})`);
      linhas.push("");
    });
  } else {
    linhas.push("🔴 NENHUMA LOJA COM ESTOQUE DISPONÍVEL NO MOMENTO");
    linhas.push("------------------------------------------------------------");
    linhas.push("");
  }

  linhas.push("📋 LISTA DE TODAS AS LOJAS ANALISADAS:");
  linhas.push("------------------------------------------------------------");
  lojas.forEach((loja, i) => {
    const statusDisponivel = loja.availableSupply ? "✅ DISPONÍVEL" : "❌ ESGOTADO";
    linhas.push(`[${i + 1}] ${loja.storeName || "Loja"} [${statusDisponivel}]`);
    linhas.push(`    Endereço: ${loja.storeStreetAddress || ""}, ${loja.storeAddressNumber || "S/N"} - ${loja.storeDistrict || ""}`);
    linhas.push(`    Previsão/Aviso: ${loja.messageNextBatch || "Nenhuma mensagem"}`);
    linhas.push(`    Resgatados: ${loja.redeemed || 0} / Fornecidos: ${loja.redeemedSupply || 0}`);
    linhas.push("");
  });

  linhas.push("============================================================");
  linhas.push("DADOS BRUTOS (JSON):");
  linhas.push("============================================================");
  linhas.push(JSON.stringify(lojas, null, 2));

  const conteudo = linhas.join("\n");

  fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
  fs.writeFileSync(caminhoArquivo, conteudo, "utf8");

  return caminhoArquivo;
}

function carregarEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

function getConsumerCredentials() {
  carregarEnv();

  // 1. Tenta carregar do arquivo .env
  if (process.env.BOTICARIO_CONSUMER_CPF) {
    return {
      cpf: String(process.env.BOTICARIO_CONSUMER_CPF).replace(/\D/g, ""),
      birthday:
        process.env.BOTICARIO_CONSUMER_BIRTHDAY || CONSUMER_BIRTHDAY_DEFAULT,
      name: process.env.BOTICARIO_CONSUMER_NAME || "",
      gender: process.env.BOTICARIO_CONSUMER_GENDER || "F",
      motherName: process.env.BOTICARIO_CONSUMER_MOTHER_NAME || "",
    };
  }

  // 2. Tenta carregar de comandos-config.json
  try {
    const configPath = path.join(process.cwd(), "comandos-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config?.boticariomimo?.consumerCpf) {
        return {
          cpf: String(config.boticariomimo.consumerCpf).replace(/\D/g, ""),
          birthday:
            config.boticariomimo.consumerBirthday || CONSUMER_BIRTHDAY_DEFAULT,
          name: config.boticariomimo.consumerName || "",
          gender: config.boticariomimo.consumerGender || "F",
          motherName: config.boticariomimo.consumerMotherName || "",
        };
      }
    }
  } catch {}

  // 3. Fallback
  return {
    cpf: CONSUMER_CPF_DEFAULT,
    birthday: CONSUMER_BIRTHDAY_DEFAULT,
    name: "",
    gender: "F",
    motherName: "",
  };
}

async function verificarMimosBoticario({
  cidade = "Natal",
  campaignId = null,
  consumerCpf = null,
  consumerBirthday = null,
  salvarTxt = true,
  onOutput = null,
} = {}) {
  const activeCampaignId = campaignId || (await obterCampanhaAtiva());
  const creds = getConsumerCredentials();
  const activeCpf = consumerCpf || creds.cpf;
  const activeBirthday = consumerBirthday || creds.birthday;

  const emitir = async (msg) => {
    if (typeof onOutput === "function") {
      await onOutput(msg);
    }
  };

  await emitir(`🔍 Buscando mimos O Boticário em *${cidade}*...`);

  // 1. Identificar consumidor para obter accessToken fresco
  let token = INITIAL_TOKEN;
  try {
    const ident = await identificarConsumidor({
      campaignId: activeCampaignId,
      consumerCpf: activeCpf,
      consumerBirthday: activeBirthday,
      bearerToken: INITIAL_TOKEN,
    });
    if (ident.accessToken) {
      token = ident.accessToken;
    }
  } catch (err) {
    console.warn("Aviso: Falha ao renovar token via identify, tentando token base:", err.message);
  }

  // 2. Vincular canal loja física
  try {
    await vincularCanalLoja({
      campaignId: activeCampaignId,
      consumerCpf: activeCpf,
      token,
    });
  } catch (err) {
    console.warn("Aviso ao vincular canal loja:", err.message);
  }

  // 3. Buscar lojas na cidade
  const lojas = await buscarLojasPorTexto({
    campaignId: activeCampaignId,
    consumerCpf: activeCpf,
    cidade,
    token,
  });

  if (!Array.isArray(lojas) || lojas.length === 0) {
    return {
      total: 0,
      disponiveis: [],
      esgotadas: [],
      mensagem: `⚠️ Nenhuma loja encontrada para a busca *"${cidade}"*.`,
    };
  }

  const disponiveis = lojas.filter((l) => Boolean(l.availableSupply));
  const esgotadas = lojas.filter((l) => !l.availableSupply);

  let caminhoTxt = null;
  if (salvarTxt) {
    const pastaLogs = path.join(process.cwd(), "logs-requisicoes");
    const nomeArquivo = `lojas-boticario-${cidade.toLowerCase().replace(/[^a-z0-9]/g, "_")}.txt`;
    caminhoTxt = salvarLojasEmTxt({
      lojas,
      cidade,
      campanha: campaignId,
      caminhoArquivo: path.join(pastaLogs, nomeArquivo),
    });
  }

  // Monta mensagem amigável para o WhatsApp
  const linhasResposta = [];
  if (disponiveis.length > 0) {
    linhasResposta.push(`🎉 *MIMO DISPONÍVEL NO BOTICÁRIO!*`);
    linhasResposta.push(`📍 Cidade: *${cidade}*`);
    linhasResposta.push(`🛍️ Lojas com brinde liberado: *${disponiveis.length}* de ${lojas.length}\n`);

    disponiveis.forEach((loja, idx) => {
      linhasResposta.push(`*${idx + 1}. ${loja.storeName}*`);
      linhasResposta.push(`📍 ${loja.storeStreetAddress}, ${loja.storeAddressNumber} - ${loja.storeDistrict}`);
      linhasResposta.push("");
    });
    linhasResposta.push(`👉 Acesse o app O Boticário para garantir o seu resgate antes que esgote!`);
  } else {
    linhasResposta.push(`❌ *Nenhum mimo disponível no momento em ${cidade}*`);
    linhasResposta.push(`🏬 Total de lojas consultadas: ${lojas.length}`);

    const avisoPrevisao = lojas.find((l) => l.messageNextBatch)?.messageNextBatch;
    if (avisoPrevisao) {
      linhasResposta.push(`\nℹ️ *Aviso:* ${avisoPrevisao}`);
    }
  }

  return {
    total: lojas.length,
    disponiveis,
    esgotadas,
    caminhoTxt,
    mensagem: linhasResposta.join("\n"),
  };
}

module.exports = {
  verificarMimosBoticario,
  identificarConsumidor,
  vincularCanalLoja,
  buscarLojasPorTexto,
  salvarLojasEmTxt,
  obterCampanhaAtiva,
  validarCampanha,
  extrairSlugCampanha,
  salvarCampanhaConfig,
  iniciarAgendadorDiarioCampanha,
  FALLBACK_CAMPAIGN,
};

// Se for executado diretamente no terminal: node Comandos/BoticarioMimo/index.js [cidade]
if (require.main === module) {
  const cidadeArg = process.argv.slice(2).join(" ") || "Natal";
  console.log(`[BOTICÁRIO MIMO] Testando busca para cidade: ${cidadeArg}...`);

  verificarMimosBoticario({
    cidade: cidadeArg,
    onOutput: (txt) => console.log(txt),
    salvarTxt: true,
  })
    .then((res) => {
      console.log("\n--- RESULTADO ---");
      console.log(res.mensagem);
      if (res.caminhoTxt) {
        console.log(`\nArquivo salvo: ${res.caminhoTxt}`);
      }
    })
    .catch((err) => {
      console.error("Erro no teste:", err);
    });
}
