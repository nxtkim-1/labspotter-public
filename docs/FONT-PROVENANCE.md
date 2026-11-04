# Font provenance (checked 2026-11-04)

Woff2 files in gui/src/fonts, with their source. Upstream: Fontsource packages on npm (OFL-1.1 licence files copied into docs/font-licences/).

| File | Upstream file | Version | SHA-256 | Match |
|---|---|---|---|---|
| plexmono-400.woff2 | @fontsource/ibm-plex-mono 5.3.0, files/ibm-plex-mono-latin-400-normal.woff2 | 5.3.0 | 08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7 | byte-identical |
| plexmono-500.woff2 | same package, ibm-plex-mono-latin-500-normal.woff2 | 5.3.0 | 01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22 | byte-identical |
| Inter-400.woff2 | @fontsource-variable/inter 5.3.0, files/inter-latin-wght-normal.woff2 | 5.3.0 | 3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62 | byte-identical (unchanged file) |
| fraunces-var.woff2 | @fontsource-variable/fraunces 5.3.0, files/fraunces-latin-opsz-normal.woff2 | 5.3.0 | 7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783 | byte-identical (replaced the earlier copy) |

The earlier Fraunces copy (sha 48282a415ec2...) had every font table equal to this file after decoding, except the head table and the hinting program. The earlier Plex copies had the same names and glyphs but no hinting.
Update 2026-11-04 (later): v2.css no longer references any .ttf. It now uses the official woff2 files above plus two new ones:

| File | Upstream file | Version | SHA-256 | Match |
|---|---|---|---|---|
| plexmono-600.woff2 | @fontsource/ibm-plex-mono 5.3.0, ibm-plex-mono-latin-600-normal.woff2 | 5.3.0 | 0d1f0b8d0722224e32e9f28261bdc86c79115be73444ae5eceb73976a1bcdf83 | byte-identical |
| spacegrotesk-wght.woff2 | @fontsource-variable/space-grotesk 5.3.0, space-grotesk-latin-wght-normal.woff2 | 5.3.0 | 0640890476fc1198ab4de571fb658de443c4d85b66466ec09534a8737ab1ce9d | byte-identical |

These are Latin-subset builds. The built dist contains no .ttf. The old .ttf files (IBMPlexMono*.ttf, Inter.ttf, SpaceGrotesk.ttf) are still in gui/src/fonts and as unreferenced old assets in dist/assets of this private branch. Their origin and version are not recorded. Leave them out of any public clean export.
(Earlier text:) The .ttf files (IBM Plex Mono, Inter, Space Grotesk) were not replaced. Their embedded notices read: Copyright 2017 IBM Corp. (OFL 1.1); Copyright 2016 The Inter Project Authors (OFL 1.1); Copyright 2020 The Space Grotesk Project Authors (OFL 1.1). Their upstream version and origin are not recorded.
Licence texts: docs/font-licences/*.txt. This note covers font files only. It is not a legal opinion.


## Full SHA-256 of the referenced woff2 files (2026-11-04)
See docs/CLEAN-EXPORT-MANIFEST.md for the full hashes and the list of files to leave out of a public clean export. The manifest was made by diffing the remote tree listing against a fresh rebuild, not from this text. Licence texts are in docs/font-licences/.
