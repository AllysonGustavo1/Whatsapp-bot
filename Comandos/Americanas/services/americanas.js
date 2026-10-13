"use strict";

const https = require("https");
const zlib = require("zlib");
const CookieJar = require("../utils/cookieJar");
const {
  criarEmailTemporario,
  aguardarCodigoAmericanas,
} = require("./mailtm");
const {
  gerarSenhaForte,
  gerarCPF,
  gerarNomeCompleto,
  gerarTelefone,
  gerarDataNascimento,
  gerarSexo,
  gerarEndereco,
} = require("../utils/generators");

const BASE_URL = process.env.AMERICANAS_BASE_URL || "https://www.americanas.com.br";
const VTEX_UI_VERSION = "vtex.login@2.69.1/vtex.react-vtexid@4.70.0";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function buildMultipart(fields) {
  const boundary = `----WebKitFormBoundary${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value ?? ""}\r\n`
    );
  }
  parts.push(`--${boundary}--\r\n`);
  const body = parts.join("");

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: Buffer.byteLength(body),
  };
}

function httpRequest(url, options = {}, jar = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyBuf = options.body
      ? Buffer.isBuffer(options.body)
        ? options.body
        : Buffer.from(typeof options.body === "string" ? options.body : JSON.stringify(options.body))
      : null;

    const headers = {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      ...(options.headers || {}),
    };

    if (jar && jar.toHeader()) {
      headers["Cookie"] = jar.toHeader();
    }

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
        headers,
      },
      (res) => {
        if (jar) {
          jar.updateFromResponse(res);
        }

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
              body: rawText,
              data,
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

// ─── Fluxo de Autenticação VTEX ID ──────────────────────────────────────────

async function startLogin(jar, email) {
  const form = buildMultipart({
    accountName: "americanas",
    scope: "americanas",
    returnUrl: `${BASE_URL}/`,
    callbackUrl: `${BASE_URL}/api/vtexid/oauth/finish?popup=false`,
    user: email,
    fingerprint: "",
  });

  const res = await httpRequest(
    `${BASE_URL}/api/vtexid/pub/authentication/startlogin`,
    {
      method: "POST",
      headers: {
        "content-type": form.contentType,
        "x-vtex-ui": VTEX_UI_VERSION,
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
      },
      body: form.body,
    },
    jar
  );

  return res.data;
}

async function sendAccessKey(jar, email) {
  const form = buildMultipart({
    email,
    locale: "pt-BR",
  });

  const res = await httpRequest(
    `${BASE_URL}/api/vtexid/pub/authentication/accesskey/send`,
    {
      method: "POST",
      headers: {
        "content-type": form.contentType,
        "x-vtex-ui": VTEX_UI_VERSION,
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
      },
      body: form.body,
    },
    jar
  );

  return res.data;
}

async function setPasswordWithAccessKey(jar, email, newPassword, accessKey) {
  const form = buildMultipart({
    login: email,
    newPassword,
    accesskey: accessKey,
  });

  const res = await httpRequest(
    `${BASE_URL}/api/vtexid/pub/authentication/classic/setpassword`,
    {
      method: "POST",
      headers: {
        "content-type": form.contentType,
        "x-vtex-ui": VTEX_UI_VERSION,
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
      },
      body: form.body,
    },
    jar
  );

  if (!res.ok || res.data?.authStatus !== "Success") {
    throw new Error(
      `Falha ao definir senha (${res.status}): ${JSON.stringify(res.data || res.body)}`
    );
  }

  return res.data;
}

async function validateLogin(jar, email, password) {
  const form = buildMultipart({
    login: email,
    password,
  });

  const res = await httpRequest(
    `${BASE_URL}/api/vtexid/pub/authentication/classic/validate`,
    {
      method: "POST",
      headers: {
        "content-type": form.contentType,
        "x-vtex-ui": VTEX_UI_VERSION,
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
      },
      body: form.body,
    },
    jar
  );

  return {
    success: res.ok && res.data?.authStatus === "Success",
    data: res.data,
    status: res.status,
  };
}

async function refreshSession(jar) {
  await httpRequest(
    `${BASE_URL}/api/vtexid/pub/authentication/accesskey/send`,
    { method: "GET" },
    jar
  );
}

// ─── Cadastro de Perfil e Checkout ──────────────────────────────────────────

async function updateProfileGraphQL(jar, profileData) {
  const query = `
    mutation SaveProfile($profile: ProfileInput) {
      updateProfile(profile: $profile) {
        id
        email
        firstName
        lastName
        document
        phone
        birthDate
        gender
      }
    }
  `;

  const variables = {
    profile: {
      firstName: profileData.firstName,
      lastName: profileData.lastName,
      document: profileData.document,
      phone: profileData.phone,
      birthDate: profileData.birthDate,
      gender: profileData.gender,
    },
  };

  const res = await httpRequest(
    `${BASE_URL}/_v/private/graphql/v1`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        referer: `${BASE_URL}/account`,
      },
      body: JSON.stringify({ query, variables }),
    },
    jar
  );

  return res.data;
}

async function saveAddressGraphQL(jar, address) {
  const query = `
    mutation SaveAddress($address: AddressInput) {
      saveAddress(address: $address) {
        id
        addressType
        street
        number
        neighborhood
        city
        state
        postalCode
        receiverName
      }
    }
  `;

  const variables = {
    address: {
      addressType: "residential",
      postalCode: address.postalCode,
      street: address.street,
      number: address.number,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      country: address.country || "BRA",
      receiverName: address.receiverName || "Destinatario",
      complement: address.complement || null,
    },
  };

  const res = await httpRequest(
    `${BASE_URL}/_v/private/graphql/v1`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        referer: `${BASE_URL}/account`,
      },
      body: JSON.stringify({ query, variables }),
    },
    jar
  );

  return res.data;
}

async function updateClientProfile(jar, profileData) {
  const resOrderForm = await httpRequest(
    `${BASE_URL}/api/checkout/pub/orderForm`,
    { method: "GET" },
    jar
  );

  const orderFormId = resOrderForm.data?.orderFormId;
  if (!orderFormId) return null;

  const res = await httpRequest(
    `${BASE_URL}/api/checkout/pub/orderForm/${orderFormId}/attachments/clientProfileData`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: profileData.email,
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        document: profileData.document,
        documentType: "cpf",
        phone: profileData.phone,
      }),
    },
    jar
  );

  return res.data;
}

async function updateShippingData(jar, address) {
  const resOrderForm = await httpRequest(
    `${BASE_URL}/api/checkout/pub/orderForm`,
    { method: "GET" },
    jar
  );

  const orderFormId = resOrderForm.data?.orderFormId;
  if (!orderFormId) return null;

  const res = await httpRequest(
    `${BASE_URL}/api/checkout/pub/orderForm/${orderFormId}/attachments/shippingData`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedAddresses: [
          {
            addressType: "residential",
            receiverName: address.receiverName,
            postalCode: address.postalCode,
            city: address.city,
            state: address.state,
            country: address.country || "BRA",
            street: address.street,
            number: address.number,
            neighborhood: address.neighborhood,
          },
        ],
      }),
    },
    jar
  );

  return res.data;
}

function formatarDataIso(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return `${str}T00:00:00.000Z`;
  }
  return str;
}

function normalizarSexo(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (s === "m" || s === "masculino" || s === "male") return "male";
  if (s === "f" || s === "feminino" || s === "female") return "female";
  return s;
}

/**
 * Cria uma conta completa com e-mail temporário, senha definitiva e perfil vinculado
 */
async function criarContaCompleta({
  senha = null,
  preencherPerfil = true,
  dadosPerfil = null,
  onProgress = null,
} = {}) {
  const notify = (step, info = "") => {
    if (typeof onProgress === "function") {
      onProgress({ step, info });
    }
  };

  const jar = new CookieJar();
  const password = senha || process.env.AMERICANAS_DEFAULT_PASSWORD || gerarSenhaForte();

  // 1. Criar e-mail temporário no Mail.tm
  notify("temp_mail_creating", "Criando e-mail temporário no Mail.tm...");
  const tempMail = await criarEmailTemporario();
  const email = tempMail.email;
  notify("temp_mail_created", `E-mail gerado: ${email}`);

  // 2. Iniciar sessão VTEX
  notify("start_login", "Inicializando sessão VTEX na Americanas...");
  await startLogin(jar, email);

  // 3. Disparar código de verificação
  notify("send_access_key", "Solicitando código de acesso...");
  await sendAccessKey(jar, email);

  // 4. Aguardar o código
  notify("waiting_email_code", "Aguardando código chegar no e-mail...");
  const { codigo } = await aguardarCodigoAmericanas({
    email,
    token: tempMail.token,
    onTick: ({ tentativa, elapsedMs }) => {
      notify("polling_inbox", `Aguardando código (${tentativa}ª tentativa, ${Math.round(elapsedMs / 1000)}s)...`);
    },
  });
  notify("email_code_received", `Código recebido com sucesso: ${codigo}`);

  // 5. Definir senha definitiva
  notify("setting_password", "Definindo senha definitiva na Americanas...");
  const authResult = await setPasswordWithAccessKey(jar, email, password, codigo);
  notify("password_set", "Senha definida e conta provisionada com sucesso!");

  // 6. Preencher dados de perfil
  let profile = null;
  if (preencherPerfil) {
    notify("updating_profile", "Vinculando perfil e endereço de entrega completo...");
    const nomeInfo = dadosPerfil?.nome
      ? {
          firstName: dadosPerfil.nome.split(" ")[0],
          lastName: dadosPerfil.nome.split(" ").slice(1).join(" ") || "Silva",
        }
      : gerarNomeCompleto();

    const birthDateRaw = dadosPerfil?.birthDate || dadosPerfil?.nascimento;
    const birthDate = formatarDataIso(birthDateRaw) || gerarDataNascimento();
    const gender = normalizarSexo(dadosPerfil?.gender || dadosPerfil?.sexo) || gerarSexo();
    const endereco = dadosPerfil?.endereco || dadosPerfil?.address || gerarEndereco();
    const receiverName = `${nomeInfo.firstName} ${nomeInfo.lastName}`;

    const fullAddress = {
      ...endereco,
      receiverName,
    };

    profile = {
      email,
      firstName: nomeInfo.firstName,
      lastName: nomeInfo.lastName,
      document: dadosPerfil?.cpf || gerarCPF(),
      phone: dadosPerfil?.telefone || gerarTelefone(),
      birthDate,
      gender,
      address: fullAddress,
    };

    try {
      await updateProfileGraphQL(jar, profile);
      await saveAddressGraphQL(jar, fullAddress);
      await updateClientProfile(jar, profile);
      await updateShippingData(jar, fullAddress);
      notify("profile_updated", "Dados cadastrais e endereço salvos (Checkout liberado)!");
    } catch (profileError) {
      notify("profile_warning", `Aviso no perfil: ${profileError.message}`);
    }
  }

  // 7. Validar login independente (non-fatal — conta já está criada)
  notify("validating_login", "Validando login com usuário e senha...");
  let loginValidated = false;
  try {
    // Tenta validar com uma sessão limpa para evitar conflito de cookies
    const freshJar = new CookieJar();
    await startLogin(freshJar, email);
    const loginCheck = await validateLogin(freshJar, email, password);
    loginValidated = loginCheck.success;
  } catch (validationErr) {
    // ignora — a conta já foi criada com sucesso
  }
  if (loginValidated) {
    notify("login_validated", "Login verificado e funcionando perfeitamente!");
  } else {
    notify("login_warning", "Aviso: validação de login não confirmou, mas a conta foi criada com sucesso.");
  }

  return {
    email,
    password,
    userId: authResult.userId,
    profile,
    mailPassword: tempMail.senhaMailbox,
    criadoEm: new Date().toISOString(),
  };
}

// ─── Consulta de Pedidos e Códigos de Retirada ──────────────────────────────

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(node, visitor) {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visitor);
    }
    return;
  }
  if (!isObject(node)) return;
  visitor(node);
  for (const value of Object.values(node)) {
    walk(value, visitor);
  }
}

function pickFirstString(obj, keys) {
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key].trim()) {
      return obj[key].trim();
    }
  }
  return null;
}

function collectOrderIds(payload) {
  const ids = new Set();
  const regex = /^\d{10,}-\d{2}$/;
  walk(payload, (obj) => {
    for (const key of ["orderId", "orderID", "orderNumber", "id"]) {
      const value = obj[key];
      if (typeof value === "string" && regex.test(value.trim())) {
        ids.add(value.trim());
      }
    }
  });
  return [...ids];
}

async function fetchOrdersList(jar) {
  const attempts = [
    `${BASE_URL}/api/oms/user/orders/?page=1&includeProfileLastPurchases=true`,
    `${BASE_URL}/api/oms/user/orders`,
    `${BASE_URL}/api/oms/user/orders/?page=1`,
    `${BASE_URL}/api/oms/user/orders?page=1&pageSize=25`,
  ];

  let lastError = null;
  for (const url of attempts) {
    const res = await httpRequest(
      url,
      {
        method: "GET",
        headers: {
          accept: "*/*",
          referer: `${BASE_URL}/account`,
          "x-vtex-user-agent": "vtex.my-orders-app@3.25.6",
        },
      },
      jar
    );

    if (!res.ok) {
      lastError = new Error(`Falha ao listar pedidos (${res.status})`);
      continue;
    }

    const payload = typeof res.data === "object" ? res.data : JSON.parse(res.body);
    const ids = collectOrderIds(payload);
    if (ids.length > 0) {
      return ids;
    }
  }

  return [];
}

async function fetchOrder(orderId, jar) {
  const url = `${BASE_URL}/api/oms/user/orders/${encodeURIComponent(orderId)}`;
  const res = await httpRequest(
    url,
    {
      method: "GET",
      headers: {
        accept: "*/*",
        referer: `${BASE_URL}/account`,
        "x-vtex-user-agent": "vtex.my-orders-app@3.25.6",
      },
    },
    jar
  );

  if (!res.ok) {
    throw new Error(`Falha ao consultar pedido ${orderId} (${res.status})`);
  }

  return typeof res.data === "object" ? res.data : JSON.parse(res.body);
}

async function fetchTakeoutToken(orderId, jar) {
  const url = `${BASE_URL}/_v/private/takeout-token/${encodeURIComponent(orderId)}`;
  const res = await httpRequest(
    url,
    {
      method: "GET",
      headers: {
        accept: "*/*",
        referer: `${BASE_URL}/account`,
      },
    },
    jar
  );

  if (!res.ok) {
    return {
      takeoutToken: null,
      isReadyForPickup: null,
      requestError: `HTTP ${res.status}`,
    };
  }

  try {
    const payload = typeof res.data === "object" ? res.data : JSON.parse(res.body);
    return {
      takeoutToken: typeof payload.takeoutToken === "string" ? payload.takeoutToken : null,
      isReadyForPickup: typeof payload.isReadyForPickup === "boolean" ? payload.isReadyForPickup : null,
      requestError: null,
    };
  } catch {
    return {
      takeoutToken: null,
      isReadyForPickup: null,
      requestError: "Resposta inválida",
    };
  }
}

function extractCodes(payload) {
  const rows = [];
  const seen = new Set();
  const orderKeys = ["orderId", "orderID", "orderNumber", "code", "codigoPedido"];
  const pickupKeys = ["pickupCode", "withdrawalCode", "pickupPassword", "collectionCode", "deliveryCode", "codigoRetirada", "pin"];

  walk(payload, (obj) => {
    const orderCode = pickFirstString(obj, orderKeys);
    const retiradaCode = pickFirstString(obj, pickupKeys);
    if (!orderCode && !retiradaCode) return;

    const status = pickFirstString(obj, ["status", "state", "orderStatus"]);
    const source = pickFirstString(obj, ["packageId", "id", "itemId"]);
    const uniq = `${orderCode || ""}|${retiradaCode || ""}|${source || ""}`;
    if (seen.has(uniq)) return;
    seen.add(uniq);

    rows.push({
      pedido: orderCode || "(não encontrado)",
      retirada: retiradaCode || "(não encontrado)",
      status: status || "(sem status)",
      referencia: source || "(sem referência)",
    });
  });

  return rows;
}

/**
 * Consulta pedidos e códigos de retirada de uma única conta
 */
async function consultarPedidosConta({ email, password, orderId = null, detalhado = false }) {
  const jar = new CookieJar();
  await startLogin(jar, email);
  const loginRes = await validateLogin(jar, email, password);
  if (!loginRes.success) {
    throw new Error(`Falha no login da conta ${email}`);
  }
  await refreshSession(jar);

  const orderIds = orderId ? [orderId] : await fetchOrdersList(jar);
  const pedidos = [];
  const produtos = [];

  for (const id of orderIds) {
    try {
      const data = await fetchOrder(id, jar);

      if (detalhado && Array.isArray(data.items)) {
        for (const item of data.items) {
          const unitPrice = typeof item.sellingPrice === "number" ? item.sellingPrice / 100 : (item.price || 0) / 100;
          const quantity = item.quantity || 1;
          const totalPrice = item.priceDefinition?.total ? item.priceDefinition.total / 100 : unitPrice * quantity;

          produtos.push({
            conta: email,
            pedido: id,
            status: data.status || "",
            statusDescricao: data.statusDescription || data.status || "",
            produto: item.name || "(sem nome)",
            quantidade: quantity,
            precoUnitario: unitPrice,
            precoTotal: totalPrice,
          });
        }
      }

      const takeout = await fetchTakeoutToken(id, jar);
      const codes = extractCodes(data).map((row) => ({
        conta: email,
        pedido: row.pedido === "(não encontrado)" ? id : row.pedido,
        retirada: takeout.takeoutToken || row.retirada,
        prontoParaRetirada: takeout.isReadyForPickup === true ? "sim" : takeout.isReadyForPickup === false ? "nao" : "(indisponivel)",
        status: data.status || row.status,
        statusDescricao: data.statusDescription || data.status || "",
      }));

      if (codes.length === 0) {
        pedidos.push({
          conta: email,
          pedido: id,
          retirada: takeout.takeoutToken || "(não encontrado)",
          prontoParaRetirada: takeout.isReadyForPickup === true ? "sim" : takeout.isReadyForPickup === false ? "nao" : "(indisponivel)",
          status: data.status || "(sem status)",
          statusDescricao: data.statusDescription || data.status || "",
        });
      } else {
        pedidos.push(...codes);
      }
    } catch (errOrder) {
      pedidos.push({
        conta: email,
        pedido: id,
        retirada: "(erro)",
        prontoParaRetirada: "nao",
        status: "(erro)",
        obs: errOrder.message,
      });
    }
  }

  return {
    email,
    pedidos,
    produtos,
  };
}

module.exports = {
  CookieJar,
  httpRequest,
  startLogin,
  sendAccessKey,
  setPasswordWithAccessKey,
  validateLogin,
  refreshSession,
  criarContaCompleta,
  consultarPedidosConta,
  fetchOrdersList,
  fetchOrder,
  fetchTakeoutToken,
};
