// Gnu: plugin de Kino para el catálogo autorizado de GNULA HD.
// La página fuente entrega los metadatos y los servidores; Kino captura el
// media del reproductor autorizado sin resolver captchas ni saltarse controles.

const BASE = "https://ww3.gnulahd.nu";
const CARD_RE = /<a\s+class="gnrd-card"\s+href="([^"]+)"\s+title="([^"]*)"[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<\/a>/gi;
const EP_RE = /<a\s+class="gnrd-epc"\s+href="([^"]+)"[^>]*data-s="(\d+)"[^>]*data-e="(\d+)"[\s\S]*?<span class="gnrd-epc-title">([^<]*)<\/span>/gi;
const PLAYER_RE = /var\s+_gnrdPid\s*=\s*(\d+)\s*,\s*_gnrdTok\s*=\s*"([a-f0-9]+)"/i;
const SAFE_SERVER_HOSTS = new Set(["vidara.to", "voe.sx"]);
const UPCOMING_RE = /<a\s+class="gnrd-card\s+gnest-ecard"([\s\S]*?)<\/a>/gi;

function text(value) {
  return String(value || "")
    .replace(/&#8211;|&#x2013;/gi, "–")
    .replace(/&#8217;|&#x27;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function slugFromUrl(url) {
  const match = /\/(?:ver|proximos-estrenos)\/([^/?#]+)\/?$/i.exec(url);
  return match ? match[1] : url;
}

function absoluteUrl(url) {
  return new URL(url, BASE).href;
}

function itemFromCard(url, title, poster, year) {
  const lower = title.toLowerCase();
  const kind = /anime/.test(lower) ? "series" : /serie|temporada|season/.test(lower) ? "series" : "movie";
  return {
    id: slugFromUrl(url),
    ref: absoluteUrl(url),
    title: text(title),
    kind,
    year: year || undefined,
    poster: absoluteUrl(poster),
    siteGenres: [],
  };
}

function cards(html) {
  const out = [];
  const seen = new Set();
  let match;
  while ((match = CARD_RE.exec(html)) && out.length < 100) {
    const yearMatch = /class="gnrd-card-metaline"[^>]*>[\s\S]*?<span>(\d{4})<\/span>/i.exec(match[0]);
    const item = itemFromCard(match[1], match[2], match[3], yearMatch && yearMatch[1]);
    const genreMatch = /class="gnrd-card-genres">([^<]*)<\/div>/i.exec(match[0]);
    item.siteGenres = genreMatch
      ? genreMatch[1].split("·").map((genre) => text(genre)).filter(Boolean)
      : [];
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function upcomingCards(html, type) {
  const out = [];
  const seen = new Set();
  let match;
  while ((match = UPCOMING_RE.exec(html)) && out.length < 100) {
    const card = match[1];
    const kindMatch = /data-tipo="(pelicula|serie)"/i.exec(card);
    const hrefMatch = /href="([^"]*\/proximos-estrenos\/[^"?#]+\/?)"/i.exec(card);
    const titleMatch = /class="gnrd-card-title">([^<]+)<\/span>/i.exec(card);
    const imageMatch = /<img[^>]+src="([^"]+)"/i.exec(card);
    const dateMatch = /class="gnest-ecard-date">([^<]+)<\/span>/i.exec(card);
    if (!kindMatch || !hrefMatch || !titleMatch || !imageMatch) continue;
    if (type && type !== "all" && kindMatch[1] !== type) continue;
    const ref = absoluteUrl(hrefMatch[1]);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const yearMatch = /(\d{4})/.exec(dateMatch ? dateMatch[1] : "");
    out.push({
      id: slugFromUrl(ref),
      ref,
      title: text(titleMatch[1]),
      kind: kindMatch[1] === "serie" ? "series" : "movie",
      year: yearMatch ? yearMatch[1] : undefined,
      poster: absoluteUrl(imageMatch[1]),
    });
  }
  return yearFiltered(out);
}

function upcomingUrl(mode, type, page = 1) {
  const path = "/proximos-estrenos/" + (page > 1 ? "page/" + page + "/" : "");
  const params = [];
  if (mode === "released") params.push("ver=estrenadas");
  if (type && type !== "all") params.push("tipo=" + encodeURIComponent(type));
  return BASE + path + (params.length ? "?" + params.join("&") : "");
}

function yearFiltered(items) {
  let from = "all";
  let to = "all";
  try {
    from = String(kino.config.get("yearFrom") || "all");
    to = String(kino.config.get("yearTo") || "all");
  } catch {}
  const min = from === "all" ? 0 : Number(from);
  const max = to === "all" ? 9999 : Number(to);
  return items.filter((item) => {
    if (!item.year) return from === "all" && to === "all";
    const year = Number(item.year);
    return year >= Math.min(min, max) && year <= Math.max(min, max);
  });
}

async function classifySearchItems(items) {
  const candidates = items.slice(0, 20);
  await Promise.all(candidates.map(async (item) => {
    try {
      const html = await get(item.ref);
      if (/<meta\s+name="description"\s+content="Serie\b/i.test(html) || /<[^>]*>Serie\s*[·|]/i.test(html)) {
        item.kind = "series";
      }
    } catch {}
  }));
  return items;
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
  return classifySearchItems(cards(await get(searchUrl(value))));
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

export async function section({ tab }) {
  await null;
  const tabs = [
    { id: "novedades", label: "Novedades", labelEn: "New" },
    { id: "peliculas", label: "Películas", labelEn: "Movies" },
    { id: "series", label: "Series", labelEn: "Series" },
    { id: "anime", label: "Anime", labelEn: "Anime" },
    { id: "proximos", label: "Próximos estrenos", labelEn: "Coming soon" },
    { id: "estrenadas", label: "Ya estrenadas", labelEn: "Released" },
    { id: "generos", label: "Géneros", labelEn: "Genres" },
    { id: "anos", label: "Años", labelEn: "Years" },
  ];
  const chosen = tabs.some((entry) => entry.id === tab) ? tab : "peliculas";
  const allRows = (await home()).map((row) => ({ ...row, items: yearFiltered(row.items) }));
  const cleanItem = (item) => {
    const clean = { ...item };
    delete clean.siteGenres;
    return clean;
  };
  if (["proximos", "estrenadas"].includes(chosen)) {
    const mode = chosen === "estrenadas" ? "released" : "next";
    const html = await get(upcomingUrl(mode, "all"));
    const all = upcomingCards(html, "all");
    const movies = all.filter((item) => item.kind === "movie");
    const series = all.filter((item) => item.kind === "series");
    return {
      tabs,
      tab: chosen,
      rows: [
        { id: chosen + "-todo", title: chosen === "proximos" ? "Todos los próximos estrenos" : "Todas las ya estrenadas", ref: `upcoming:${mode}:all`, items: all.slice(0, 60) },
        { id: chosen + "-peliculas", title: "Películas", ref: `upcoming:${mode}:pelicula`, items: movies.slice(0, 60) },
        { id: chosen + "-series", title: "Series", ref: `upcoming:${mode}:serie`, items: series.slice(0, 60) },
      ].filter((row) => row.items.length),
    };
  }
  if (["novedades", "peliculas", "series", "anime"].includes(chosen)) {
    const wanted = chosen === "novedades" ? ["peliculas", "series", "anime"] : [chosen];
    return {
      tabs,
      tab: chosen,
      rows: allRows
        .filter((row) => wanted.includes(row.id))
        .map((row) => ({ ...row, items: row.items.map(cleanItem), ref: "/list/" + row.id })),
    };
  }

  const rows = chosen === "generos" ? allRows : allRows;
  const allItems = rows.flatMap((row) => row.items).map(cleanItem);
  const grouped = new Map();
  const byYear = new Map();
  for (const row of rows) {
    for (const item of row.items) {
      if (item.year) {
        if (!byYear.has(item.year)) byYear.set(item.year, []);
        byYear.get(item.year).push(cleanItem(item));
      }
      const genres = item.siteGenres && item.siteGenres.length ? item.siteGenres : [row.title];
      for (const genre of genres) {
        if (!grouped.has(genre)) grouped.set(genre, []);
        const clean = cleanItem(item);
        if (!grouped.get(genre).some((existing) => existing.id === clean.id)) grouped.get(genre).push(clean);
      }
    }
  }
  const genreRows = [...grouped.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 18)
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([genre, items]) => ({
      id: "genre-" + genre.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title: genre,
      items: items.slice(0, 60),
      ref: "genre:" + genre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    }));
  const yearRows = [...byYear.entries()]
    .sort(([a], [b]) => Number(b) - Number(a))
    .slice(0, 18)
    .map(([year, items]) => ({ id: "year-" + year, title: year, items: items.slice(0, 60) }));
  return {
    tabs,
    tab: chosen,
    rows: chosen === "generos" ? genreRows : yearRows,
  };
}

export async function browse(ref, cursor) {
  await null;
  const page = Number(cursor || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100) throw kino.error("not_found", "Página inválida");
  const lists = {
    peliculas: "/ver/peliculas/",
    series: "/ver/series/",
    anime: "/ver/anime/",
    proximos: "/proximos-estrenos/",
  };
  const raw = String(ref || "list:peliculas");
  const upcoming = /^upcoming:(next|released):(all|pelicula|serie)$/.exec(raw);
  if (upcoming) {
    const mode = upcoming[1];
    const type = upcoming[2];
    const html = await get(upcomingUrl(mode, type, page));
    const items = upcomingCards(html, type);
    return { items, next: items.length >= 100 ? String(page + 1) : undefined };
  }
  let path = lists[raw.replace(/^\/list\//, "")] || null;
  if (!path && raw.startsWith("genre:")) path = "/genres/" + raw.slice(6) + "/";
  if (!path) throw kino.error("not_found", "Categoría inválida");
  const separator = path.includes("?") ? "&" : "?";
  const items = yearFiltered(cards(await get(BASE + path + separator + "page=" + page)));
  return { items: items.map((item) => { delete item.siteGenres; return item; }), next: items.length === 100 ? String(page + 1) : undefined };
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
  }))).filter((server) => {
    try { return SAFE_SERVER_HOSTS.has(new URL(server.url).hostname.replace(/^www\./, "")); } catch { return false; }
  });
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
