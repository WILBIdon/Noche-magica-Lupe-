# Mil y Una Noches

Invitación digital. Al abrirla: video de apertura, "frota la lámpara", el video de
magia, la alfombra voladora y un torbellino dorado que abre la tarjeta.

```
portada → aladin1 → lámpara → aladin2 → alfombra → torbellino → tarjeta
```

---

## Desplegar en Railway

1. En Railway: **New Project → Deploy from GitHub repo** y elige este repositorio.
2. No hay nada que configurar. Railway detecta Node, no hay dependencias que
   instalar y arranca con `node server.js`.
3. En **Settings → Networking → Generate Domain** sale la dirección pública.

El puerto lo pone Railway en `PORT`; el servidor lo lee solo.
La comprobación de salud está en `/healthz`.

### Dominio propio

En **Settings → Networking → Custom Domain**. Vale la pena: el enlace que llega
por WhatsApp se ve mucho mejor con un dominio corto.

---

## Qué hay aquí

| archivo | para qué |
|---|---|
| `server.js` | el servidor, sin dependencias |
| `web/index.html` | la invitación entera: estilos, marcado y guion en un archivo |
| `web/*.mp4` | los tres videos y la música |
| `web/*.jpg` | el fondo del palacio y la lámpara |
| `herramientas/comprimir.swift` | comprime video y le aplica fundido al audio |
| `railway.json` | ajustes del despliegue |

### Por qué el servidor no es un `serve` cualquiera

Hace tres cosas que hacen falta aquí:

1. **Responde peticiones Range (206).** Sin esto Safari no puede adelantar los
   videos ni empezar a verlos antes de bajarlos enteros.
2. **Arma el documento completo** alrededor de `web/index.html`. Ese archivo está
   escrito para ir dentro de un Artifact de Claude y no trae `<html>`, `<head>`
   ni `<body>` propios. Sin el `<meta viewport>` la tarjeta se vería diminuta en
   cualquier celular.
3. **Comprime el HTML** una sola vez al arrancar: de 50 KB baja a 18 KB.

---

## Qué hay que editar

Todo lo configurable está al principio del `<script>` en `web/index.html`:

```js
const CFG = {
  whatsapp: "",   // número con indicativo y sin signos, ej "573001234567"
  mapa: "https://www.google.com/maps/search/?api=1&query=...",
  fiesta: "2027-01-09T19:00:00-05:00"
};
```

Mientras `whatsapp` esté vacío, el botón "Confirmar asistencia" abre su ventana
pero sin enlace a WhatsApp.

---

## Probar en el Mac

```bash
node server.js
```

Y abre `http://localhost:3000`.

Para ver qué soporta un teléfono concreto, abre la dirección con `?diag` al
final: sale un panel con fps, si el teléfono tiene el movimiento reducido
activado, el estado de la música y qué soporta el navegador.

---

## Cambiar los videos

`herramientas/comprimir.swift` usa AVFoundation (sólo macOS, sin instalar nada):

```bash
swiftc -O -o herramientas/comprimir herramientas/comprimir.swift

# entrada, salida, kbps, segundos de fundido de audio, [recortar a N segundos]
./herramientas/comprimir original.mp4 web/aladin1.mp4 1600 0.8
```

Deja el índice del MP4 al principio del archivo, así el video empieza a
reproducirse mientras se descarga.

Los tres videos originales pesaban 22 MB y quedaron en 8 MB, con PSNR de 36 a
42 dB — la diferencia no se ve en pantalla de celular.

---

## Lo que no está en el repositorio

Los archivos originales de video y el MP3 (27 MB) están en `.gitignore`: no
hacen falta para desplegar y harían más lento cada build. **Están sólo en el
Mac — guárdalos aparte.**
