# Gnu — plugin de Kino

Plugin de Kino para el catálogo autorizado de GNULA HD.

## Funciones

- Búsqueda de películas, series y anime.
- Filas de Inicio para películas, series y anime.
- Navegación por categorías.
- Listado de temporadas y episodios.
- Reproducción mediante los servidores autorizados de la fuente.

## Probar localmente

Necesita Node.js 18 o superior:

```bash
node sdk/validate.mjs .
node sdk/run.mjs . search "wildwood"
node sdk/run.mjs . home
node sdk/run.mjs . episodes "https://ww3.gnulahd.nu/ver/visionquest/"
node --test test/sources.test.mjs
```

La reproducción usa `kino.browser.capture`, por lo que debe probarse dentro de
Kino en un dispositivo compatible con navegador oculto.

## Instalación

En Kino, abre Ajustes → Plugins → Agregar plugin e introduce:

```text
jlislas/GNU
```

La persona debe revisar y aprobar los hosts declarados y el permiso del
navegador oculto. Este plugin no declara descargas ni contiene credenciales.
