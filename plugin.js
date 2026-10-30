// Gnu: plugin de Kino para el catálogo autorizado de GNULA HD.
// La página fuente entrega los metadatos y los servidores; Kino captura el
// media del reproductor autorizado sin resolver captchas ni saltarse controles.

const BASE = "https://ww3.gnulahd.nu";
const CARD_RE = /<a\s+class="gnrd-card"\s+href="([^"]+)"\s+title="([^"]*)"[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<\/a>/gi;
const EP_RE = /<a\s+class="gnrd-epc"\s+href="([^"]+)"[^>]*data-s="(\d+)"[^>]*data-e="(\d+)"[\s\S]*?<span class="gnrd-epc-title">([^<]*)<\/span>/gi;
const PLAYER_RE = /var\s+_gnrdPid\s*=\s*(\d+)\s*,\s*_gnrdTok\s*=\s*"([a-f0-9]+)"/i;

function text(value) {
  return String(value || "")
    .replace(/&#8211;|&#x2013;/gi, "–")
    .replace(/&#8217;|&#x27;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function slugFromUrl(url) {
  const match = /\/ver\/([^/?#]+)\/?$/i.exec(url);
  return match ? match[1] : url;
}

function absoluteUrl(url) {
  return new URL(url, BASE).href;
}

function itemFromCard(url, title, poster) {
  const lower = title.toLowerCase();
  const kind = /anime/.test(lower) ? "series" : /serie|temporada|season/.test(lower) ? "series" : "movie";
  return {
    id: slugFromUrl(url),
    ref: absoluteUrl(url),
    title: text(title),
    kind,
    poster: absoluteUrl(poster),
  };
}

function cards(html) {
  const out = [];
  const seen = new Set();
  let match;
  while ((match = CARD_RE.exec(html)) && out.length < 100) {
    const item = itemFromCard(match[1], match[2], match[3]);
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

async function get(url) {
  const response = await kino.fetch(url);
  if (!response.ok) throw kino.error("unavailable", "La fuente no respondió");
  return response.text();
}

function searchUrl(query) {
  return BASE + "/?s=" + encodeURIComponent(String(query || "").trim());
}

export async function search(query) {
  await null;
  const value = String(query && query.q || "").trim();
  if (!value) return [];
  return cards(await get(searchUrl(value)));
}

export async function home() {
  await null;
  const sections = [
    ["peliculas", "Películas", "/ver/peliculas/", "movie"],
    ["series", "Series", "/ver/series/", "series"],
    ["anime", "Anime", "/ver/anime/", "series"],
  ];
  const rows = [];
  for (const [id, title, path, kind] of sections) {
    try {
      const items = cards(await get(BASE + path)).map((item) => ({ ...item, kind }));
      if (items.length) rows.push({ id, ref: path, title, items });
    } catch (error) {
      try { kino.log("home row failed", id, error.message); } catch {}
    }
  }
  return rows;
}

export async function browse(ref, cursor) {
  await null;
  const page = Number(cursor || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100) throw kino.error("not_found", "Página inválida");
  const path = String(ref || "/ver/peliculas/");
  const separator = path.includes("?") ? "&" : "?";
  const items = cards(await get(BASE + path + separator + "page=" + page));
  return { items, next: items.length === 100 ? String(page + 1) : undefined };
}

function jsonLd(html) {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html);
  if (!match) return {};
  try { return JSON.parse(match[1]); } catch { return {}; }
}

function pageInfo(html, url) {
  const data = jsonLd(html);
  const type = String(data["@type"] || "").toLowerCase();
  const poster = data.image || "";
  return {
    title: text(data.name || slugFromUrl(url)),
    overview: text(data.description),
    year: String(data.dateCreated || "").slice(0, 4) || undefined,
    poster: poster ? absoluteUrl(poster) : undefined,
    kind: type === "tvseries" ? "series" : "movie",
  };
}

export async function episodes(ref) {
  await null;
  const url = absoluteUrl(ref);
  const html = await get(url);
  const info = pageInfo(html, url);
  const result = [];
  let match;
  while ((match = EP_RE.exec(html))) {
    result.push({
      season: Number(match[2]),
      number: Number(match[3]),
      title: text(match[4]) || `Episodio ${match[2]}x${match[3]}`,
      ref: absoluteUrl(match[1]),
    });
  }
  if (!result.length) throw kino.error("not_found", "No hay episodios disponibles");
  result.sort((a, b) => a.season - b.season || a.number - b.number);
  return { series: { title: info.title, poster: info.poster }, episodes: result };
}

function unpack(value) {
  const binary = atob(value);
  const key = [103, 78, 55, 100];
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) ^ key[i & 3];
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function playerServers(html, pageUrl) {
  const match = PLAYER_RE.exec(html);
  if (!match) throw kino.error("not_found", "No hay servidores disponibles");
  const endpoint = BASE + "/wp-json/gnrd/v1/player?id=" + match[1] + "&t=" + match[2];
  const response = await kino.fetch(endpoint, { headers: { "X-Gn-Scr": "kino", "Referer": pageUrl } });
  if (!response.ok) throw kino.error("unavailable", "No se pudo consultar el reproductor");
  const data = unpack(response.json().p);
  return (data.langs || []).flatMap((language) => (language.servers || []).map((server) => ({
    label: `${language.label || "Video"} · ${server.title || "Servidor"}`,
    url: server.src,
  })));
}

async function capture(server) {
  const page = await kino.browser.capture(server.url, { timeoutMs: 18000 });
  const media = page.media && page.media[0];
  if (!media) throw kino.error("unavailable", "El servidor no entregó video");
  return { url: media.url, mime: media.mime, headers: media.headers };
}

export async function resolve(ref) {
  await null;
  const pageUrl = absoluteUrl(ref);
  const html = await get(pageUrl);
  const servers = await playerServers(html, pageUrl);
  if (!servers.length) throw kino.error("unavailable", "No hay servidores disponibles");
  let firstError;
  for (const server of servers.slice(0, 3)) {
    try {
      const stream = await capture(server);
      return { ...stream, label: server.label };
    } catch (error) {
      firstError = error;
      if (!["blocked", "timeout", "browser_unavailable"].includes(error.code)) throw error;
    }
  }
  throw firstError || kino.error("unavailable", "No respondió ningún servidor");
}
