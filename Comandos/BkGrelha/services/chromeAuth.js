const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { gerarCPF } = require("../../Americanas/utils/generators");
const {
  httpRequestJson,
  trocarCodePorToken,
} = require("./bkApi");
const { snapshotMensagensEmail, aguardarCodigoBk } = require("./emailCode");

puppeteer.use(StealthPlugin());

const AUTH_URL =
  "https://auth.burgerking.com.br/auth/realms/digital/protocol/openid-connect/auth";
const REDIRECT_URI = "burgerking.com.br.appandroid:/oauth2redirect";
const CUSTOMER_API_BASE = "https://api-customer.zamp.com.br";
const CUSTOMER_API_KEY =
  "YRESAQ15WLA568GM6UXUSN63Y5E4MIOOKQ4PCQ4X6XX9373PFG";
const CUSTOMER_API_TOKEN = "13DB3163-D2F9-4097-B693-6E7D1038404E";

const NOMES_PRIMEIROS = [
  "Lucas",
  "Gabriel",
  "Mateus",
  "Rafael",
  "Bruno",
  "Felipe",
  "Gustavo",
  "Thiago",
  "Mariana",
  "Camila",
  "Juliana",
  "Beatriz",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64Url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function gerarPkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(
    crypto.createHash("sha256").update(verifier).digest()
  );
  const state = base64Url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

function encontrarChromeExecutable() {
  const candidatos = [
    process.env.BK_CHROME_PATH,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe"
      ),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ].filter(Boolean);

  for (const cand of candidatos) {
    if (fs.existsSync(cand)) return cand;
  }
  return undefined;
}

function gerarCelularAleatorio() {
  const ddds = ["11", "21", "31", "41", "51", "71", "81", "84", "85"];
  const ddd = ddds[Math.floor(Math.random() * ddds.length)];
  let numero = "9";
  for (let i = 0; i < 8; i += 1) {
    numero += String(Math.floor(Math.random() * 10));
  }
  return `${ddd}${numero}`;
}

async function preencherInput(page, selector, valor) {
  await page.waitForSelector(selector, { visible: true, timeout: 20000 });
  const el = await page.$(selector);
  if (el) {
    await el.focus().catch(() => {});
    await el.click({ clickCount: 3 }).catch(() => {});
    await sleep(150);
  }
  await page.keyboard.type(valor, { delay: 40 }).catch(() => {});

  // Garante sincronizacao em inputs controlados sem quebrar mascaras de CPF
  await page.evaluate(
    (sel, val) => {
      const input = document.querySelector(sel);
      if (!input) return;
      const atualNorm = String(input.value || "").replace(/\D/g, "");
      const alvoNorm = String(val || "").replace(/\D/g, "");
      const jaPreenchido =
        input.value === val || (alvoNorm.length >= 6 && atualNorm === alvoNorm);
      if (!jaPreenchido) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        if (setter) setter.call(input, val);
        else input.value = val;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    selector,
    valor
  );
}

async function clicarSubmit(page, textoPreferido = "Continuar") {
  const buttons = await page.$$("button:not([disabled])");
  const rx = textoPreferido ? new RegExp(textoPreferido, "i") : null;
  for (const btn of buttons) {
    const txt = await page
      .evaluate((el) => el.innerText || el.textContent || "", btn)
      .catch(() => "");
    if (!rx || rx.test(txt)) {
      await btn.click().catch(() => {});
      return true;
    }
  }
  return page.evaluate((texto) => {
    const botoes = [...document.querySelectorAll("button")].filter(
      (b) => !b.disabled
    );
    let alvo = null;
    if (texto) {
      const r = new RegExp(texto, "i");
      alvo = botoes.find((b) => r.test(b.innerText || ""));
    }
    if (!alvo) {
      alvo =
        document.querySelector('button[type="submit"]:not([disabled])') ||
        botoes[0];
    }
    if (!alvo) return false;
    alvo.scrollIntoView?.({ block: "center" });
    alvo.click();
    return true;
  }, textoPreferido);
}

async function preencherOtp(page, codigo) {
  await page.waitForSelector("input.input-code", { timeout: 20000 });
  const boxes = await page.$$("input.input-code");
  if (boxes.length > 0) {
    await boxes[0].click().catch(() => {});
    await page.keyboard.type(codigo, { delay: 55 }).catch(() => {});
  }

  await page.evaluate((cod) => {
    const inputs = [...document.querySelectorAll("input.input-code")];
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    inputs.forEach((box, idx) => {
      const ch = cod[idx] || "";
      if (box.value !== ch) {
        if (setter) setter.call(box, ch);
        else box.value = ch;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
        box.dispatchEvent(
          new KeyboardEvent("keyup", { key: ch, bubbles: true })
        );
      }
    });
    const hidden = document.querySelector('input[name="code"]');
    if (hidden && hidden.value !== cod) {
      if (setter) setter.call(hidden, cod);
      else hidden.value = cod;
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, codigo);

  await sleep(350);
  await clicarSubmit(page, "Continuar");
}

function extrairCodigoRedirect(urlStr) {
  if (!urlStr || !urlStr.startsWith(REDIRECT_URI)) return null;
  try {
    const u = new URL(urlStr);
    const error = u.searchParams.get("error");
    if (error) {
      return { error: u.searchParams.get("error_description") || error };
    }
    const code = u.searchParams.get("code");
    if (code) return { code };
  } catch {
    // ignora URL malformada
  }
  return null;
}

function customerApiHeaders(accessToken) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "okhttp/5.0.0-alpha.2",
    "app-device": "samsung SM-G977N - Android 9 (SDK: 28)",
    "app-platform": "android",
    "app-version": "5.18.0 (5420)",
    "x-api-key": CUSTOMER_API_KEY,
    "x-api-token": CUSTOMER_API_TOKEN,
  };
}

async function completarCadastroZamp(accessToken, { onLog } = {}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  const headers = customerApiHeaders(accessToken);

  let stateRes = await httpRequestJson(
    `${CUSTOMER_API_BASE}/customer/enrollment/current_state`,
    { method: "GET", headers }
  );

  if (stateRes.status === 204) {
    return;
  }
  if (stateRes.status >= 400) {
    throw new Error(
      `Falha ao consultar enrollment BK (HTTP ${stateRes.status}): ${JSON.stringify(stateRes.data).slice(0, 180)}`
    );
  }

  for (let step = 0; step < 6; step += 1) {
    if (
      stateRes.status === 204 ||
      !stateRes.data?.state?.operations ||
      stateRes.data.state.operations.length === 0
    ) {
      return;
    }

    const op =
      stateRes.data.state.operations.find((o) => o.rel === "send_field") ||
      stateRes.data.state.operations[0];
    if (!op || !op.uri) {
      return;
    }

    const url = new URL(op.uri);
    for (const [k, v] of Object.entries(op.expected_params?.query_params || {})) {
      url.searchParams.set(k, v);
    }

    const field = stateRes.data.state.current_field;
    const bodyObj = {};
    if (field === "phone_number") {
      bodyObj.phone_number = gerarCelularAleatorio();
      log(`Enviando telefone (${bodyObj.phone_number}) para finalizar cadastro BK...`);
    } else if (field === "given_name") {
      bodyObj.given_name =
        NOMES_PRIMEIROS[Math.floor(Math.random() * NOMES_PRIMEIROS.length)];
      log(`Enviando nome (${bodyObj.given_name}) para finalizar cadastro BK...`);
    } else {
      throw new Error(`Campo de cadastro BK inesperado: ${field || "desconhecido"}`);
    }

    stateRes = await httpRequestJson(
      url.toString(),
      { method: op.method || "POST", headers },
      JSON.stringify(bodyObj)
    );

    if (stateRes.status >= 400) {
      throw new Error(
        `Falha ao enviar ${field} no cadastro BK (HTTP ${stateRes.status}): ${JSON.stringify(stateRes.data).slice(0, 180)}`
      );
    }
  }
}

async function autenticarContaNoChrome({ email, senha, cpf, onLog } = {}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  if (!email) {
    throw new Error("Email obrigatorio para criar/autenticar conta no Chrome.");
  }

  const cpfUsado = (cpf && cpf.replace(/\D/g, "")) || gerarCPF();
  const snapshotEmail = await snapshotMensagensEmail({ email, senha });

  const { verifier, challenge, state } = gerarPkce();
  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", "app-bk");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "email profile");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("kc_idp_hint", "email");

  const executablePath = encontrarChromeExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-chrome-"));
  const isLinuxSemDisplay =
    process.platform === "linux" && !process.env.DISPLAY;
  const headless =
    process.env.BK_CHROME_HEADLESS === "1"
      ? "new"
      : process.env.BK_CHROME_HEADLESS === "0"
        ? false
        : isLinuxSemDisplay
          ? "new"
          : false;

  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--window-size=460,820",
  ];
  if (process.platform === "linux") {
    launchArgs.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
  }

  let browser = null;
  let authCode = null;
  let authError = null;

  try {
    log(`Abrindo Chrome para criar conta ${email}...`);
    browser = await puppeteer.launch({
      ...(executablePath ? { executablePath } : {}),
      headless,
      userDataDir,
      ignoreDefaultArgs: ["--enable-automation"],
      args: launchArgs,
      defaultViewport: null,
    });

    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    const capturarUrl = (urlStr) => {
      const parsed = extrairCodigoRedirect(urlStr);
      if (!parsed) return;
      if (parsed.code) authCode = parsed.code;
      if (parsed.error && !authError) authError = parsed.error;
    };

    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (ev) => {
      capturarUrl(ev?.request?.url || "");
    });
    cdp.on("Network.responseReceivedExtraInfo", (ev) => {
      capturarUrl(ev?.headers?.location || ev?.headers?.Location || "");
    });
    page.on("framenavigated", (frame) => {
      capturarUrl(frame.url());
    });

    await page.goto(authUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (authError) {
      throw new Error(`Keycloak rejeitou autenticacao: ${authError}`);
    }

    await page.waitForSelector('input:not([type="hidden"])', { timeout: 25000 });
    await sleep(1000);
    await preencherInput(page, 'input:not([type="hidden"])', email);
    await sleep(1200);

    const deadlineOtpScreen = Date.now() + 40000;
    let ultimoCliqueEmail = 0;
    let telaOtpPronta = false;

    while (Date.now() < deadlineOtpScreen) {
      const estado = await page
        .evaluate(() => {
          const codes = document.querySelectorAll("input.input-code").length;
          const btn = [...document.querySelectorAll("button")].find(
            (b) => !b.disabled && /continuar/i.test(b.innerText || "")
          );
          return { codes, temContinuar: Boolean(btn) };
        })
        .catch(() => ({ codes: 0, temContinuar: false }));

      if (estado.codes >= 6) {
        telaOtpPronta = true;
        break;
      }

      if (estado.temContinuar && Date.now() - ultimoCliqueEmail > 4500) {
        await clicarSubmit(page, "Continuar");
        ultimoCliqueEmail = Date.now();
      }
      await sleep(800);
    }

    if (!telaOtpPronta) {
      const resumoPagina = await page
        .evaluate(() => (document.body?.innerText || "").trim().slice(0, 300))
        .catch(() => "");
      throw new Error(
        `Tela de codigo OTP nao apareceu no Chrome.${resumoPagina ? ` Pagina: ${resumoPagina}` : ""}`
      );
    }

    log(`Aguardando codigo OTP no email ${email}...`);
    const codigo = await aguardarCodigoBk({
      email,
      senha,
      snapshot: snapshotEmail,
      onLog: log,
    });

    await preencherOtp(page, codigo);

    let ultimoCliqueCpf = 0;
    const deadlineAuth = Date.now() + 45000;

    while (Date.now() < deadlineAuth && !authCode && !authError) {
      const st = await page
        .evaluate(() => {
          const cpfInput = document.querySelector('input[name="cpf"]');
          const bodyText = document.body?.innerText || "";
          const digitarNovamenteBtn = [...document.querySelectorAll("button")].find(
            (b) => !b.disabled && /digitar novamente/i.test(b.innerText || "")
          );
          return {
            temCpf: Boolean(cpfInput),
            cpfVal: cpfInput ? cpfInput.value : "",
            temDigitarNovamente: Boolean(digitarNovamenteBtn),
            cpfJaCadastrado:
              Boolean(document.querySelector('input[name="validationType"]')) ||
              /j[aá]\s+[eé]\s+cadastrado/i.test(bodyText),
          };
        })
        .catch(() => null);

      if (!st) {
        await sleep(800);
        continue;
      }

      if (st.cpfJaCadastrado) {
        const errCpf = new Error(
          `CPF (${cpfUsado}) ja possui cadastro no Burger King.`
        );
        errCpf.code = "CPF_JA_CADASTRADO";
        throw errCpf;
      }

      if (st.temDigitarNovamente) {
        await clicarSubmit(page, "Digitar novamente");
        await sleep(800);
        continue;
      }

      if (st.temCpf && Date.now() - ultimoCliqueCpf > 6000) {
        if (!st.cpfVal || st.cpfVal.replace(/\D/g, "") !== cpfUsado) {
          log(`Preenchendo CPF (${cpfUsado}) no Chrome...`);
          await preencherInput(page, 'input[name="cpf"]', cpfUsado);
          await sleep(1000);
        }
        await clicarSubmit(page, "Continuar");
        ultimoCliqueCpf = Date.now();
        await sleep(2000);
        continue;
      }

      await sleep(800);
    }

    if (authError) {
      throw new Error(`Erro no redirect OAuth do Burger King: ${authError}`);
    }
    if (!authCode) {
      const textoFinal = await page
        .evaluate(() => (document.body?.innerText || "").trim().slice(0, 300))
        .catch(() => "");
      throw new Error(
        `Tempo esgotado aguardando autenticacao no Chrome.${textoFinal ? ` Pagina: ${textoFinal}` : ""}`
      );
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignora erro ao limpar perfil temporario
    }
  }

  log("Trocando authorization code por token BK...");
  const tokenRes = await trocarCodePorToken(authCode, verifier);
  if (!tokenRes?.accessToken || !tokenRes?.refreshToken) {
    throw new Error("Nao foi possivel obter access_token/refresh_token do BK.");
  }

  await completarCadastroZamp(tokenRes.accessToken, { onLog: log });

  return {
    accessToken: tokenRes.accessToken,
    refreshToken: tokenRes.refreshToken,
    customerId: tokenRes.customerId,
    email: (tokenRes.email || email).toLowerCase(),
    cpf: cpfUsado,
    customerStatus: "ACTIVE",
    metodoChrome: true,
  };
}

module.exports = {
  autenticarContaNoChrome,
  completarCadastroZamp,
};
