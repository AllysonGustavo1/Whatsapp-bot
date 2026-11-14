const http = require("http");
const https = require("https");
const zlib = require("zlib");
const sharp = require("sharp");
const QRCode = require("qrcode-terminal/vendor/QRCode");
const QRErrorCorrectLevel = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel");

const API_KEY =
  "AMkt8TI2WEVbpb8QNlVdk9ilWot6odCDL5MDGICW1ItpkYd9e1DfCrsqxMb6hdZN";
const BASIC_AUTH = Buffer.from(
  "app-bk:cabf15a5-0e91-4782-82f2-9a4e90eaf52f"
).toString("base64");
const TOKEN_URL =
  "https://auth.burgerking.com.br/auth/realms/digital/protocol/openid-connect/token";
const HOME_BASE_URL =
  "https://api.zamp.com.br/burgerking/loyalty/shakeandwin/Home";
const SHAKE_BASE_URL =
  "https://api.zamp.com.br/burgerking/loyalty/shakeandwin/Shake";

function descomprimirBuffer(buf, encoding) {
  return new Promise((resolve) => {
    const enc = String(encoding || "").toLowerCase();
    const finish = (err, out) => resolve(err ? buf : out);
    if (enc.includes("gzip")) {
      zlib.gunzip(buf, finish);
    } else if (enc.includes("deflate")) {
      zlib.inflate(buf, finish);
    } else if (enc.includes("br")) {
      zlib.brotliDecompress(buf, finish);
    } else {
      resolve(buf);
    }
  });
}

function httpRequestJson(urlStr, opts = {}, body = null, timeoutMs = 18000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const mod = urlObj.protocol === "http:" ? http : https;
    const headers = { ...(opts.headers || {}) };
    const bodyBuf =
      body !== null && body !== undefined
        ? Buffer.isBuffer(body)
          ? body
          : Buffer.from(String(body), "utf8")
        : null;

    if (bodyBuf && !Object.keys(headers).some((k) => k.toLowerCase() === "content-length")) {
      headers["Content-Length"] = bodyBuf.length;
    }

    let finalizado = false;
    const req = mod.request(
      urlObj,
      {
        method: opts.method || "GET",
        headers,
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", async () => {
          if (finalizado) return;
          finalizado = true;
          clearTimeout(timer);
          try {
            const rawBuf = Buffer.concat(chunks);
            const decBuf = await descomprimirBuffer(
              rawBuf,
              res.headers["content-encoding"]
            );
            const rawText = decBuf.toString("utf8");
            let data = rawText;
            try {
              data = JSON.parse(rawText);
            } catch {
              // Mantem texto puro quando nao e JSON
            }
            resolve({
              status: res.statusCode || 0,
              headers: res.headers || {},
              data,
              raw: rawText,
            });
          } catch (err) {
            reject(err);
          }
        });
        res.on("error", (err) => {
          if (finalizado) return;
          finalizado = true;
          clearTimeout(timer);
          reject(err);
        });
      }
    );

    const timer = setTimeout(() => {
      if (finalizado) return;
      finalizado = true;
      const errTimeout = new Error(`Timeout (${timeoutMs}ms) em ${urlStr}`);
      req.destroy();
      reject(errTimeout);
    }, timeoutMs);

    req.on("error", (err) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      reject(err);
    });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function decodificarJwt(token) {
  if (!token || typeof token !== "string") return null;
  const partes = token.split(".");
  if (partes.length < 2) return null;
  try {
    let b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function tokenEstaExpirado(token, margemSegundos = 60) {
  const payload = decodificarJwt(token);
  if (!payload || !payload.exp) return true;
  const agora = Math.floor(Date.now() / 1000);
  return payload.exp <= agora + margemSegundos;
}

function oauthHeaders() {
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
    Authorization: `Basic ${BASIC_AUTH}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9; SM-G977N Build/LMY48Z)",
  };
}

function normalizarTokenResponse(data) {
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const payload = decodificarJwt(accessToken);
  const expiresIn = Number(data.expires_in) || 3600;
  return {
    accessToken,
    refreshToken,
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
    customerId: payload?.sub || null,
    email: payload?.email || null,
  };
}

async function renovarToken(refreshToken) {
  if (!refreshToken) {
    throw new Error("Refresh token ausente para renovacao.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();

  const res = await httpRequestJson(
    TOKEN_URL,
    { method: "POST", headers: oauthHeaders() },
    body
  );

  if (res.status >= 200 && res.status < 300 && res.data?.access_token) {
    return normalizarTokenResponse(res.data);
  }
  const msg =
    res.data?.error_description ||
    res.data?.error ||
    res.raw ||
    `HTTP ${res.status}`;
  const err = new Error(`Falha ao renovar token (${res.status}): ${msg}`);
  err.status = res.status;
  err.response = res.data;
  throw err;
}

async function trocarCodePorToken(authCode, codeVerifier) {
  const body = new URLSearchParams({
    code: authCode,
    grant_type: "authorization_code",
    redirect_uri: "burgerking.com.br.appandroid:/oauth2redirect",
    code_verifier: codeVerifier,
  }).toString();

  const res = await httpRequestJson(
    TOKEN_URL,
    { method: "POST", headers: oauthHeaders() },
    body
  );

  if (res.status >= 200 && res.status < 300 && res.data?.access_token) {
    return normalizarTokenResponse(res.data);
  }
  const msg =
    res.data?.error_description ||
    res.data?.error ||
    res.raw ||
    `HTTP ${res.status}`;
  throw new Error(`Falha ao trocar authorization code (${res.status}): ${msg}`);
}

function apiHeaders(accessToken) {
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
    "app-device": "samsung SM-G977N - Android 9 (SDK: 28)",
    "app-platform": "android",
    "app-version": "5.17.0 (5417)",
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=UTF-8",
    "User-Agent": "okhttp/5.0.0-alpha.2",
    "x-api-key": API_KEY,
  };
}

async function consultarHomeGrelha(accessToken, customerId) {
  if (!customerId) throw new Error("customerId ausente ao consultar Home Grelha.");
  return httpRequestJson(
    `${HOME_BASE_URL}/${customerId}`,
    {
      method: "GET",
      headers: apiHeaders(accessToken),
    },
    null,
    25000
  );
}

async function abrirGrelha(accessToken, customerId) {
  if (!customerId) throw new Error("customerId ausente ao consultar Grelha.");
  return httpRequestJson(`${SHAKE_BASE_URL}/${customerId}`, {
    method: "GET",
    headers: apiHeaders(accessToken),
  });
}

async function girarGrelha(accessToken, customerId) {
  if (!customerId) throw new Error("customerId ausente ao girar Grelha.");
  const body = JSON.stringify({ idCustomer: customerId });
  return httpRequestJson(
    SHAKE_BASE_URL,
    {
      method: "POST",
      headers: apiHeaders(accessToken),
    },
    body,
    22000
  );
}

function extrairNomePremioImagem(imageUrls, type) {
  if (!imageUrls || type === "NONE") return null;
  const candidateUrl = imageUrls.active || imageUrls.shared || "";
  if (!candidateUrl || candidateUrl.includes("nao_ganhou")) return null;
  const filename = candidateUrl.split("/").pop() || "";
  const semExt = filename.replace(/\.[a-z0-9]+$/i, "");
  if (!semExt) return null;
  return semExt.replace(/[_-]+/g, " ").trim();
}

const PROMO_PRECO_IMAGEM_BASES = new Set([
  "premio_disponivel_shake",
  "premio_disponivel_2shakes",
  "premio_disponivel_combo_whopper",
  "premio_disponivel_combo_bigking1",
  "combo_whopper_2x25",
  "para_compartilhar_2whopper_combo",
]);

function formatarDescricaoPremio(premio, codigo) {
  const p = String(premio || "Sem premio").trim();
  const c = String(codigo || "S/N").trim();
  return `PREMIO: ${p} | Codigo: ${c}`;
}

function ehRecompensaGratis(detalhes = {}) {
  if (!detalhes || typeof detalhes !== "object") return false;
  if (String(detalhes.type || "").toUpperCase() === "NONE") return false;

  const premioBase = String(
    detalhes.premioExibicao || detalhes.title || ""
  ).trim();
  if (!premioBase || /^sem\s*pr[eê]mio$/i.test(premioBase)) {
    return false;
  }

  const imageUrl = String(detalhes.imageUrl || "");
  const imgBase = (imageUrl.split("/").pop() || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase();

  if (imgBase.includes("nao_ganhou")) return false;
  if (imgBase && PROMO_PRECO_IMAGEM_BASES.has(imgBase)) return false;

  const texto = [
    detalhes.title,
    detalhes.premioExibicao,
    detalhes.description,
    imgBase,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/concorra\s+a\s+pr[eê]mios\s+na\s+faixa/gi, "");

  if (
    /\br\$\s*[1-9]\d*/i.test(texto) ||
    /\b[1-9]\d?\s*%\s*off\b/i.test(texto) ||
    /\b\d+x\d+\b/i.test(texto) ||
    /\bpor\s+r?\$\s*[1-9]/i.test(texto) ||
    /desconto/i.test(texto)
  ) {
    return false;
  }

  return (
    /\bgr[aá]tis\b/i.test(texto) ||
    /na[\s_-]*faixa/i.test(texto) ||
    /100\s*%(?:\s*off)?/i.test(texto) ||
    /(?:^|[\s_-])100[\s_-]*off\b/i.test(texto) ||
    /\bbrinde\b/i.test(texto) ||
    /\bfree\b/i.test(texto) ||
    /\bjackpot\b/i.test(texto) ||
    /\br\$\s*0(?:[,.]00?)?\b/i.test(texto) ||
    /sem[\s_-]+custo/i.test(texto)
  );
}

function extrairDetalhesPremio(data) {
  if (!data || typeof data !== "object") return {};
  const statusObj =
    data.status && typeof data.status === "object" ? data.status : {};
  const premioObj =
    data.reward || data.prize || data.coupon || data.product || {};
  const qrObj =
    premioObj.qr_code || premioObj.qrCode || data.qr_code || data.qrCode || {};
  const imageUrlsObj =
    statusObj.image_urls ||
    statusObj.imageUrls ||
    data.image_urls ||
    data.imageUrls ||
    {};

  const type = data.type || premioObj.type || null;
  const imagemNome = extrairNomePremioImagem(imageUrlsObj, type);
  const rewardName = premioObj.name || premioObj.title || data.title || null;
  const title = rewardName || statusObj.title || imagemNome || null;
  const description =
    statusObj.description ||
    data.description ||
    premioObj.description ||
    data.message ||
    null;
  const premioExibicao =
    rewardName || imagemNome || description || title || "Sem premio";
  const couponCode =
    qrObj.code ||
    premioObj.discount_code ||
    premioObj.discountCode ||
    data.share_code ||
    data.shareCode ||
    data.couponCode ||
    data.voucher ||
    premioObj.code ||
    premioObj.couponCode ||
    null;
  const qrCodeBase64 = qrObj.image || null;
  const imageUrl =
    imageUrlsObj.active || imageUrlsObj.shared || imageUrlsObj.expired || null;
  const jackpot = ehRecompensaGratis({
    type,
    title,
    premioExibicao,
    description,
    imageUrl,
  });

  return {
    type,
    statusCode: statusObj.code || data.code || null,
    buttonName: statusObj.name_button || null,
    title,
    premioExibicao,
    description,
    couponCode,
    qrCodeBase64,
    expirationDate:
      premioObj.expiration_date || premioObj.expirationDate || null,
    imageUrl,
    jackpot,
    descricaoPremio: formatarDescricaoPremio(premioExibicao, couponCode),
  };
}

function formatarResultadoGrelha(postRes, getRes = null) {
  const ref =
    postRes?.data && typeof postRes.data === "object"
      ? postRes.data
      : getRes?.data;
  const info = extrairDetalhesPremio(ref);
  const statusHttp = postRes?.status ?? getRes?.status;

  if (statusHttp === 401 || statusHttp === 403) {
    return `Token rejeitado (${statusHttp})`;
  }
  if (statusHttp === 404) {
    return info.description || "Cadastro incompleto no BK (Customer Not Found)";
  }
  if (statusHttp === 400) {
    const msg =
      typeof ref === "object" ? ref.message || ref.detail : String(ref || "");
    if (/Shake Unavailable/i.test(msg)) {
      const extra = getRes?.data ? extrairDetalhesPremio(getRes.data) : {};
      const motivo = extra.statusCode || "UNAVAILABLE";
      const cod = extra.couponCode ? ` | Codigo: ${extra.couponCode}` : "";
      const premio = extra.title ? ` | Ultimo premio: ${extra.title}` : "";
      return `Ja girou / Indisponivel hoje (${motivo}${premio}${cod})`;
    }
    return msg || "Requisicao rejeitada (400)";
  }

  if (info.descricaoPremio && (info.couponCode || info.type === "REWARD")) {
    return info.descricaoPremio;
  }

  const partes = [];
  if (info.type === "REWARD") {
    partes.push(info.title ? `Premio: ${info.title}` : "REWARD");
  } else if (info.statusCode) {
    partes.push(info.statusCode);
  }
  if (info.couponCode) partes.push(`Codigo: ${info.couponCode}`);
  if (info.buttonName && info.type !== "REWARD") partes.push(info.buttonName);
  if (info.description) partes.push(info.description);

  if (partes.length === 0) {
    return typeof ref === "string" ? ref.slice(0, 180) : `HTTP ${statusHttp}`;
  }
  return partes.join(" | ");
}

async function baixarImagemBuffer(urlStr, timeoutMs = 20000) {
  if (!urlStr || typeof urlStr !== "string") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(urlStr, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ao baixar imagem`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    try {
      return await sharp(buf).png().toBuffer();
    } catch {
      return buf;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function gerarQrCodePngBuffer(codigoTexto, { qrCodeBase64 = null } = {}) {
  if (qrCodeBase64 && typeof qrCodeBase64 === "string") {
    const clean = qrCodeBase64
      .replace(/^data:image\/[^;]+;base64,/i, "")
      .trim();
    if (clean) {
      const buf = Buffer.from(clean, "base64");
      if (buf.length > 0) {
        try {
          return await sharp(buf).png().toBuffer();
        } catch {
          return buf;
        }
      }
    }
  }

  if (!codigoTexto || !String(codigoTexto).trim()) {
    return null;
  }

  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(String(codigoTexto).trim());
  qr.make();

  const count = qr.getModuleCount();
  const margin = 4;
  const scale = 14;
  const size = (count + margin * 2) * scale;
  const raw = Buffer.alloc(size * size * 3, 255);

  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (!qr.isDark(r, c)) continue;
      const startY = (r + margin) * scale;
      const startX = (c + margin) * scale;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const idx = ((startY + dy) * size + (startX + dx)) * 3;
          raw[idx] = 0;
          raw[idx + 1] = 0;
          raw[idx + 2] = 0;
        }
      }
    }
  }

  return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
}

module.exports = {
  API_KEY,
  BASIC_AUTH,
  TOKEN_URL,
  HOME_BASE_URL,
  SHAKE_BASE_URL,
  httpRequestJson,
  decodificarJwt,
  tokenEstaExpirado,
  renovarToken,
  trocarCodePorToken,
  consultarHomeGrelha,
  abrirGrelha,
  girarGrelha,
  extrairDetalhesPremio,
  ehRecompensaGratis,
  formatarDescricaoPremio,
  formatarResultadoGrelha,
  baixarImagemBuffer,
  gerarQrCodePngBuffer,
};
