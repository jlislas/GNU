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

function upcomingPoster(url) {
  const absolute = absoluteUrl(url);
  if (!/\.webp(?:[?#]|$)/i.test(absolute)) return absolute;
  return "https://i0.wp.com/" + absolute.replace(/^https?:\/\//i, "").split("?")[0];
}

function itemFromCard(url, title, poster, year, rating) {
  const lower = title.toLowerCase();
  const kind = /anime/.test(lower) ? "series" : /serie|temporada|season/.test(lower) ? "series" : "movie";
  return {
    id: slugFromUrl(url),
    ref: absoluteUrl(url),
    title: text(title),
    kind,
    year: year || undefined,
    rating: rating || undefined,
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
    const ratingMatch = /class="gnrd-rating"[^>]*>\s*[★☆]?\s*([\d]+(?:[.,]\d+)?)/i.exec(match[0])
      || /class="gnrd-cm-rating"[^>]*>\s*[★☆]?\s*([\d]+(?:[.,]\d+)?)/i.exec(match[0]);
    const item = itemFromCard(
      match[1],
      match[2],
      match[3],
      yearMatch && yearMatch[1],
      ratingMatch ? Number(ratingMatch[1].replace(",", ".")) : undefined,
    );
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

function upcomingCards(html, type, mode) {
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
    const editorialRef = absoluteUrl(hrefMatch[1]);
    const ref = mode === "released"
      ? BASE + "/ver/" + slugFromUrl(editorialRef) + "/"
      : editorialRef;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const yearMatch = /(\d{4})/.exec(dateMatch ? dateMatch[1] : "");
    out.push({
      id: slugFromUrl(ref),
      ref,
      title: text(titleMatch[1]),
      kind: kindMatch[1] === "serie" ? "series" : "movie",
      year: yearMatch ? yearMatch[1] : undefined,
      poster: upcomingPoster(imageMatch[1]),
    });
  }
  return filterItems(out);
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

function filterItems(items) {
  let type = "all";
  let genre = "all";
  try {
    type = String(kino.config.get("contentType") || "all");
    genre = String(kino.config.get("genreFilter") || "all");
  } catch {}
  const wantedGenre = genre === "all" ? "" : genre.replace(/-/g, " ");
  return yearFiltered(items).filter((item) => {
    if (type !== "all" && item.kind !== type) return false;
    if (!wantedGenre) return true;
    return (item.siteGenres || []).some((value) => {
      const normalized = String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return normalized.includes(wantedGenre);
    });
  });
}

function newestFirst(items) {
  return [...items].sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
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

const CACHE_TTL_MS = 10 * 60 * 1000;

async function cachedGet(url, key) {
  const cacheKey = "cache:" + key;
  try {
    const saved = kino.storage.get(cacheKey);
    if (saved) {
      const entry = JSON.parse(saved);
      if (Date.now() - entry.at < CACHE_TTL_MS && typeof entry.text === "string") return entry.text;
    }
  } catch {}
  const html = await get(url);
  try { kino.storage.set(cacheKey, JSON.stringify({ at: Date.now(), text: html }), { ttlMs: CACHE_TTL_MS }); } catch {}
  return html;
}

function searchUrl(query) {
  return BASE + "/?s=" + encodeURIComponent(String(query || "").trim());
}

export async function search(query) {
  await null;
  const value = String(query && query.q || "").trim();
  if (!value) return [];
  const found = await classifySearchItems(cards(await cachedGet(searchUrl(value), "search:" + value.toLowerCase())));
  if (!query || !query.within) return found;
  const within = String(query.within);
  if (within.startsWith("/list/series")) return found.filter((item) => item.kind === "series");
  if (within.startsWith("/list/peliculas")) return found.filter((item) => item.kind === "movie");
  if (within.startsWith("/list/anime")) return found.filter((item) => item.kind === "series");
  if (within.startsWith("genre:")) {
    const wanted = within.slice(6).replace(/-/g, " ");
    return found.filter((item) => (item.siteGenres || []).some((genre) => genre.toLowerCase().includes(wanted)));
  }
  return found;
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
      const items = cards(await cachedGet(BASE + path, "home:" + path)).map((item) => ({ ...item, kind }));
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
  ];
  const chosen = tabs.some((entry) => entry.id === tab) ? tab : "peliculas";
  const allRows = (await home()).map((row) => ({ ...row, items: filterItems(row.items) }));
  const cleanItem = (item) => {
    const clean = { ...item };
    delete clean.siteGenres;
    return clean;
  };
  if (["proximos", "estrenadas"].includes(chosen)) {
    const mode = chosen === "estrenadas" ? "released" : "next";
    const html = await get(upcomingUrl(mode, "all"));
    const all = upcomingCards(html, "all", mode);
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
    const typeRows = [];
    for (const row of allRows.filter((entry) => wanted.includes(entry.id))) {
      const items = row.items.map(cleanItem);
      if (!items.length) continue;
      typeRows.push({
        id: row.id + "-disponibles",
        title: row.id === "peliculas" ? "Películas disponibles" : row.id === "series" ? "Series disponibles" : "Anime disponible",
        ref: "/list/" + row.id,
        items: newestFirst(items).slice(0, 20),
      });
      const ranked = [...items].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
      typeRows.push({
        id: row.id + "-valoradas",
        title: row.id === "peliculas" ? "Películas mejor valoradas" : row.id === "series" ? "Series mejor valoradas" : "Anime mejor valorado",
        ref: "ranked:" + row.id,
        items: ranked.slice(0, 20),
      });
      const groups = new Map();
      const years = new Map();
      for (const item of row.items) {
        if (item.year) {
          if (!years.has(item.year)) years.set(item.year, []);
          years.get(item.year).push(cleanItem(item));
        }
        for (const genre of item.siteGenres || []) {
          if (!groups.has(genre)) groups.set(genre, []);
          const clean = cleanItem(item);
          if (!groups.get(genre).some((existing) => existing.id === clean.id)) groups.get(genre).push(clean);
        }
      }
      for (const [genre, genreItems] of [...groups.entries()].sort(([, a], [, b]) => b.length - a.length).slice(0, 8)) {
        typeRows.push({
          id: row.id + "-genre-" + genre.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          title: genre,
          ref: "genre:" + genre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          items: newestFirst(genreItems).slice(0, 20),
        });
      }
    }
    return {
      tabs,
      tab: chosen,
      rows: typeRows.slice(0, 20),
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
      items: newestFirst(items).slice(0, 60),
      ref: "genre:" + genre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    }));
  return {
    tabs,
    tab: chosen,
    rows: genreRows,
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
    const items = upcomingCards(html, type, mode);
    return { items, next: items.length >= 100 ? String(page + 1) : undefined };
  }
  const ranked = /^ranked:(peliculas|series|anime)$/.exec(raw);
  if (ranked) {
    const path = "/ver/" + (ranked[1] === "peliculas" ? "peliculas" : ranked[1]) + "/";
    const rankedPage = page > 1 ? path + "?page=" + page : path;
    const items = filterItems(cards(await get(BASE + rankedPage))).sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
    return {
      items: items.slice(0, 20).map((item) => { delete item.siteGenres; return item; }),
      next: items.length >= 20 ? String(page + 1) : undefined,
    };
  }
  const yearList = /^year:(peliculas|series|anime):(\d{4})$/.exec(raw);
  if (yearList) {
    const path = "/ver/" + (yearList[1] === "peliculas" ? "peliculas" : yearList[1]) + "/";
    const pageUrl = page > 1 ? path + "?page=" + page : path;
    const source = cards(await get(BASE + pageUrl));
    const items = filterItems(source).filter((item) => item.year === yearList[2]);
    return {
      items: items.slice(0, 20).map((item) => { delete item.siteGenres; return item; }),
      next: source.length >= 100 ? String(page + 1) : undefined,
    };
  }
  let path = lists[raw.replace(/^\/list\//, "")] || null;
  if (!path && raw.startsWith("genre:")) path = "/genres/" + raw.slice(6) + "/";
  if (!path) throw kino.error("not_found", "Categoría inválida");
  const separator = path.includes("?") ? "&" : "?";
  const items = filterItems(cards(await get(BASE + path + separator + "page=" + page)));
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

export async function details(ref) {
  await null;
  const html = await cachedGet(absoluteUrl(ref), "details:" + ref);
  const info = pageInfo(html, ref);
  const genres = [...html.matchAll(/class="gnrd-card-genres"[^>]*>([^<]+)/gi)].map((m) => text(m[1]).split("·")).flat();
  const rating = /aggregateRating[\s\S]*?ratingValue"\s*:\s*([\d.]+)/i.exec(html);
  const backdrop = /https:\/\/image\.tmdb\.org\/t\/p\/w1280\/[^"' ]+/i.exec(html);
  return {
    overview: info.overview,
    poster: info.poster,
    backdrop: backdrop ? backdrop[0] : undefined,
    genres: genres.length ? [...new Set(genres.map((g) => text(g)))] : undefined,
    year: info.year,
    rating: rating ? Number(rating[1]) : undefined,
  };
}

export async function settingsStatus() {
  let count = 0;
  try { count = kino.storage.keys().filter((key) => key.startsWith("cache:")).length; } catch {}
  return { info: `Entradas en caché: ${count}` };
}

export async function action(key) {
  if (key !== "clearCache") return { message: "" };
  try { for (const item of kino.storage.keys()) if (item.startsWith("cache:")) kino.storage.remove(item); } catch {}
  return { message: "Caché vaciada" };
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
  const servers = (data.langs || []).flatMap((language) => (language.servers || []).map((server) => ({
    label: `${language.label || "Video"} · ${server.title || "Servidor"}`,
    url: server.src,
  }))).filter((server) => {
    try { return SAFE_SERVER_HOSTS.has(new URL(server.url).hostname.replace(/^www\./, "")); } catch { return false; }
  });
  let preferred = "any";
  try { preferred = String(kino.config.get("serverPreference") || "any"); } catch {}
  if (preferred !== "any") servers.sort((a, b) => Number(new URL(b.url).hostname === preferred) - Number(new URL(a.url).hostname === preferred));
  return servers;
}

async function capture(server) {
  const page = await kino.browser.capture(server.url, { timeoutMs: 18000 });
  const media = page.media && page.media[0];
  if (!media) throw kino.error("unavailable", "El servidor no entregó video");
  const subtitles = (page.subtitles || []).map((subtitle) => ({
    lang: subtitle.lang || "und",
    url: subtitle.url,
    format: subtitle.format === "srt" ? "srt" : "vtt",
  }));
  return { url: media.url, mime: media.mime, headers: media.headers, subtitles };
}

export async function resolve(ref) {
  await null;
  const separator = String(ref).lastIndexOf("|");
  const pageRef = separator > 0 ? String(ref).slice(0, separator) : String(ref);
  const selected = separator > 0 ? Number(String(ref).slice(separator + 1)) : null;
  const pageUrl = absoluteUrl(pageRef);
  const html = await get(pageUrl);
  const allServers = await playerServers(html, pageUrl);
  const servers = selected === null ? allServers : [allServers[selected]].filter(Boolean);
  if (!servers.length) throw kino.error("unavailable", "No hay servidores disponibles");
  let firstError;
  for (const server of servers.slice(0, 3)) {
    try {
      const stream = await capture(server);
      const response = { ...stream, label: server.label };
      if (stream.subtitles && !stream.subtitles.length) delete response.subtitles;
      if (selected === null) {
        const index = allServers.indexOf(server);
        response.alternatives = allServers
          .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
          .filter(({ candidateIndex }) => candidateIndex !== index)
          .slice(0, 7)
          .map(({ candidate, candidateIndex }) => ({ label: candidate.label, ref: pageUrl + "|" + candidateIndex }));
      }
      return response;
    } catch (error) {
      firstError = error;
      if (!["blocked", "timeout", "browser_unavailable"].includes(error.code)) throw error;
    }
  }
  throw firstError || kino.error("unavailable", "No respondió ningún servidor");
}
