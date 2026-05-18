const fetch = require("node-fetch");

const SHORTENER_API_BASE = process.env.SHORTENER_API_BASE || "https://menor.io";
const SHORTENER_CREATE_PATH =
  process.env.SHORTENER_CREATE_PATH || "/create_public";

function normalizeUrl(rawUrl = "") {
  const trimmed = String(rawUrl).trim();
  if (!trimmed) {
    throw new Error("URL vazia");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch (error) {
    throw new Error("URL inválida");
  }

  if (!/^(http|https):$/.test(parsed.protocol)) {
    throw new Error("URL inválida");
  }

  return parsed.toString();
}

function getShortenerEndpoint() {
  return new URL(SHORTENER_CREATE_PATH, SHORTENER_API_BASE).toString();
}

async function encurtarUrl(originalUrl) {
  const response = await fetch(getShortenerEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ original_url: originalUrl }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${errorText}`.trim());
  }

  const payload = await response.json();
  const shortUrl = payload?.data?.short_url;

  if (!payload?.success || !shortUrl) {
    throw new Error("Resposta inesperada do encurtador");
  }

  return shortUrl;
}

async function encurtarLink(rawUrl) {
  const normalizedUrl = normalizeUrl(rawUrl);
  const shortUrl = await encurtarUrl(normalizedUrl);
  return { normalizedUrl, shortUrl };
}

module.exports = {
  encurtarLink,
  normalizeUrl,
  encurtarUrl,
};
