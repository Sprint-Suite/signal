# Fonts

All three faces are SIL Open Font Licence (OFL) and self-hosted to comply
with the strict CSP (`font-src 'self'`).

| File                  | Source                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| Inter.woff2           | https://github.com/rsms/inter (InterVariable.woff2)                      |
| Fraunces.woff2        | https://cdn.jsdelivr.net/fontsource/fonts/fraunces:vf@latest/latin-wght-normal.woff2 (Fontsource) |
| JetBrainsMono.woff2   | https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@latest/latin-wght-normal.woff2 (Fontsource) |

The original plan referenced .woff2 files in google/fonts and JetBrains/JetBrainsMono;
those repos only publish .ttf, so we use Fontsource's pre-built woff2 instead.

To refresh, re-run the curl commands above. The :vf@latest tag floats; if
reproducibility matters, pin a specific version (see https://fontsource.org).
