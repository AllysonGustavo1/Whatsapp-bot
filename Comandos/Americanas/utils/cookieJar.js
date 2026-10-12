"use strict";

class CookieJar {
  constructor(initialHeader = "") {
    this.cookies = new Map();
    if (initialHeader) {
      this.parseAndSet(initialHeader);
    }
  }

  parseAndSet(header) {
    if (!header || typeof header !== "string") return;
    const parts = header.split(";");
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  set(name, value) {
    if (name && value !== undefined && value !== null) {
      this.cookies.set(String(name).trim(), String(value).trim());
    }
  }

  get(name) {
    return this.cookies.get(name);
  }

  updateFromHeaders(headers) {
    if (!headers) return;
    const rawSetCookie = headers["set-cookie"];
    if (!rawSetCookie) return;

    const list = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
    for (const item of list) {
      const firstPart = item.split(";")[0]?.trim();
      if (!firstPart) continue;
      const eq = firstPart.indexOf("=");
      if (eq <= 0) continue;
      const name = firstPart.slice(0, eq).trim();
      const value = firstPart.slice(eq + 1).trim();
      if (name) {
        this.cookies.set(name, value);
      }
    }
  }

  updateFromResponse(response) {
    if (response && response.headers) {
      this.updateFromHeaders(response.headers);
    }
  }

  toHeader() {
    return [...this.cookies.entries()]
      .filter(([k, v]) => Boolean(k) && Boolean(v))
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

module.exports = CookieJar;
