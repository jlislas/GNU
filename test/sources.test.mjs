import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../sdk/validate.mjs";

const root = join(import.meta.dirname, "..");
const card = (slug, title) => `
  <a class="gnrd-card" href="https://ww3.gnulahd.nu/ver/${slug}/" title="${title}">
    <div><img src="https://i0.wp.com/poster/${slug}.jpg"></div>
  </a>`;
const seriesPage = `
  <script type="application/ld+json">{"@type":"TVSeries","name":"Demo","image":"https://i0.wp.com/demo.jpg"}</script>
  <a class="gnrd-epc" href="https://ww3.gnulahd.nu/demo-1x02/" data-s="1" data-e="2">
    <span class="gnrd-epc-title">Segundo</span>
  </a>
  <a class="gnrd-epc" href="https://ww3.gnulahd.nu/demo-1x01/" data-s="1" data-e="1">
    <span class="gnrd-epc-title">Primero</span>
  </a>`;

function fakeFetch(routes) {
  return async (url) => {
    const body = routes[new URL(url).pathname + new URL(url).search];
    return new Response(body || "", { status: body == null ? 404 : 200, headers: { "content-type": "text/html" } });
  };
}

async function run(fn, args, fetchImpl) {
  const result = await validate(root, { run: fn, args, fetchImpl });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.drops, []);
  return result.output;
}

test("el manifiesto identifica Gnu, no activa descargas y declara el navegador", () => {
  const manifest = JSON.parse(readFileSync(join(root, "kino-plugin.json"), "utf8"));
  assert.equal(manifest.id, "gnu-gnula");
  assert.equal(manifest.name, "Gnu");
  assert.equal(manifest.browser, true);
  assert.equal(manifest.streamHosts, "any");
  assert.equal(manifest.capabilities.includes("download"), false);
});

test("search convierte tarjetas de GNULA en resultados de Kino", async () => {
  const result = await run("search", ["demo"], fakeFetch({
    "/?s=demo": card("demo", "Demo"),
  }));
  assert.equal(result.items[0].id, "demo");
  assert.equal(result.items[0].title, "Demo");
  assert.equal(result.items[0].kind, "movie");
});

test("episodes ordena los episodios por temporada y número", async () => {
  const result = await run("episodes", ["https://ww3.gnulahd.nu/ver/demo/"], fakeFetch({
    "/ver/demo/": seriesPage,
  }));
  assert.deepEqual(result.episodes.map((episode) => episode.number), [1, 2]);
  assert.equal(result.series.title, "Demo");
});
