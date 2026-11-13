/**
 * Servidor de la invitación "Mil y Una Noches".
 * Sin dependencias a propósito: nada que instalar, nada que se rompa al desplegar.
 *
 * Hace cuatro cosas que un servidor estático cualquiera no haría bien aquí:
 *  1. Responde peticiones Range (206). Sin esto Safari no puede adelantar los
 *     videos ni empezar a reproducirlos antes de bajarlos enteros.
 *  2. Arma el documento completo alrededor de web/index.html, que está escrito
 *     para ir dentro de un Artifact y no trae <html>/<head>/<body> propios.
 *     Sin el <meta viewport> la tarjeta se vería diminuta en cualquier celular.
 *  3. Completa las etiquetas Open Graph con el dominio real de cada petición
 *     (req.headers.host), para que og:image y og:url funcionen sin importar
 *     qué dominio asigne Railway o cuál se conecte después.
 *  4. Comprime el HTML por petición (de sobra barato para el tráfico de una
 *     invitación: ronda los 20 KB).
 */
import { createServer } from "node:http";
import { readFileSync, createReadStream, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const AQUI  = dirname(fileURLToPath(import.meta.url));
const RAIZ  = resolve(AQUI, "web");
const PUERTO = process.env.PORT || 3000;
const FAVICON = readFileSync(join(RAIZ, "favicon.svg"), "utf8");
const FAVICON_DATA_URI = "data:image/svg+xml;base64," + Buffer.from(FAVICON, "utf8").toString("base64");

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
  ".jpg":  "image/jpeg",  ".jpeg": "image/jpeg",
  ".png":  "image/png",   ".webp": "image/webp",
  ".gif":  "image/gif",   ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".mp4":  "video/mp4",   ".webm": "video/webm",
  ".m4a":  "audio/mp4",   ".mp3":  "audio/mpeg",  ".ogg": "audio/ogg",
  ".woff2":"font/woff2",  ".woff": "font/woff",
};

/* ── el documento, como plantilla ────────────────────────────────────────────
   %%ORIGIN%% se sustituye en cada petición por el esquema+dominio reales
   (ver servirDocumento). Así og:image y og:url quedan absolutas — lo que
   piden el estándar y WhatsApp — sin que haya que tocar el código cuando
   Railway asigne el dominio o se conecte uno propio después. ──────────── */
function armarPlantilla(){
  const fuente = readFileSync(join(RAIZ, "index.html"), "utf8");
  const corte = fuente.indexOf("</style>");
  let cabeza = "", cuerpo = fuente;
  if (corte !== -1){
    cabeza = fuente.slice(0, corte + 8);
    cuerpo = fuente.slice(corte + 8);
  }
  // el charset lo ponemos nosotros de primeras, como manda la especificación
  cabeza = cabeza.replace('<meta charset="utf-8">', "").trim();

  const titulo = "Mil y Una Noches";
  const descripcion = "Tienes una invitación esperándote. Frota la lámpara y descubre qué noche te espera.";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#050c1a">
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<link rel="canonical" href="%%ORIGIN%%/">
<meta property="og:type" content="website">
<meta property="og:locale" content="es_CO">
<meta property="og:site_name" content="${titulo}">
<meta property="og:title" content="${titulo}">
<meta property="og:description" content="${descripcion}">
<meta property="og:url" content="%%ORIGIN%%/">
<meta property="og:image" content="%%ORIGIN%%/og.jpg">
<meta property="og:image:secure_url" content="%%ORIGIN%%/og.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Mil y una noches — una invitación te espera">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${titulo}">
<meta name="twitter:description" content="${descripcion}">
<meta name="twitter:image" content="%%ORIGIN%%/og.jpg">
<style>:root{color-scheme:dark}html,body{margin:0;padding:0}img{max-width:100%}[hidden]{display:none!important}</style>
${cabeza}
</head>
<body>
${cuerpo}
</body>
</html>
`;
}

const PLANTILLA = armarPlantilla();
const cacheGzip = new Map();   // una entrada por origen visto (normalmente una sola)

/* ── utilidades ──────────────────────────────────────────────────────────── */
const comunes = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function noEncontrado(res){
  const cuerpo = "No encontrado";
  res.writeHead(404, { ...comunes, "Content-Type": "text/plain; charset=utf-8",
                       "Content-Length": Buffer.byteLength(cuerpo) });
  res.end(cuerpo);
}

function servirDocumento(req, res){
  const esquema = req.headers["x-forwarded-proto"] || "https";
  const origen = `${esquema}://${req.headers.host}`;
  const doc = PLANTILLA.split("%%ORIGIN%%").join(origen);
  const etag = `W/"doc-${Buffer.byteLength(doc).toString(16)}-${origen.length}"`;

  if (req.headers["if-none-match"] === etag){
    res.writeHead(304, { ...comunes, ETag: etag }); return res.end();
  }

  const acepta = String(req.headers["accept-encoding"] || "");
  const gz = acepta.includes("gzip");
  let datos;
  if (gz){
    // el gzip de ~20 KB es barato; igual se cachea una vez por origen visto
    // (normalmente uno solo) para no repetirlo en cada visita
    datos = cacheGzip.get(origen);
    if (!datos){ datos = gzipSync(Buffer.from(doc, "utf8")); cacheGzip.set(origen, datos); }
  } else {
    datos = Buffer.from(doc, "utf8");
  }

  res.writeHead(200, {
    ...comunes,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": datos.length,
    "Cache-Control": "no-cache",
    ETag: etag,
    ...(gz ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}),
  });
  if (req.method === "HEAD") return res.end();
  res.end(datos);
}

function servirArchivo(req, res, ruta, est){
  const tipo = TIPOS[extname(ruta).toLowerCase()] || "application/octet-stream";
  const etag = `W/"${est.size.toString(16)}-${Math.round(est.mtimeMs).toString(16)}"`;
  const base = {
    ...comunes,
    "Content-Type": tipo,
    "Accept-Ranges": "bytes",
    "Last-Modified": est.mtime.toUTCString(),
    ETag: etag,
    "Cache-Control": "public, max-age=86400",
  };

  if (req.headers["if-none-match"] === etag){
    res.writeHead(304, base); return res.end();
  }

  // Range: lo que permite adelantar el video y empezar a verlo sin bajarlo entero
  const rango = req.headers.range;
  if (rango){
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(rango).trim());
    if (m && (m[1] !== "" || m[2] !== "")){
      let ini, fin;
      if (m[1] === ""){                       // sufijo: los últimos N bytes
        const n = parseInt(m[2], 10);
        ini = Math.max(0, est.size - n); fin = est.size - 1;
      } else {
        ini = parseInt(m[1], 10);
        fin = m[2] === "" ? est.size - 1 : Math.min(parseInt(m[2], 10), est.size - 1);
      }
      if (!Number.isFinite(ini) || ini > fin || ini >= est.size){
        res.writeHead(416, { ...base, "Content-Range": `bytes */${est.size}` });
        return res.end();
      }
      res.writeHead(206, { ...base, "Content-Range": `bytes ${ini}-${fin}/${est.size}`,
                           "Content-Length": fin - ini + 1 });
      if (req.method === "HEAD") return res.end();
      return createReadStream(ruta, { start: ini, end: fin }).pipe(res);
    }
  }

  res.writeHead(200, { ...base, "Content-Length": est.size });
  if (req.method === "HEAD") return res.end();
  createReadStream(ruta).pipe(res);
}

/* ── servidor ────────────────────────────────────────────────────────────── */
const servidor = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD"){
    res.writeHead(405, { ...comunes, Allow: "GET, HEAD" }); return res.end();
  }

  let camino;
  try { camino = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { return noEncontrado(res); }

  if (camino === "/healthz"){
    res.writeHead(200, { ...comunes, "Content-Type": "text/plain" });
    return res.end(req.method === "HEAD" ? undefined : "ok");
  }

  if (camino === "/" || camino === "/index.html") return servirDocumento(req, res);

  // nadie se sale de web/
  const destino = resolve(RAIZ, "." + normalize(camino));
  if (destino !== RAIZ && !destino.startsWith(RAIZ + sep)) return noEncontrado(res);

  let est;
  try { est = statSync(destino); } catch { return noEncontrado(res); }
  if (!est.isFile()) return noEncontrado(res);

  servirArchivo(req, res, destino, est);
});

servidor.listen(PUERTO, () => {
  console.log(`Mil y Una Noches — escuchando en el puerto ${PUERTO}`);
});

for (const senal of ["SIGTERM", "SIGINT"]){
  process.on(senal, () => servidor.close(() => process.exit(0)));
}
