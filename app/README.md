# Bobine Subs (app)

L'application de [Bobine Subs](../README.fr.md) (Tauri v2 + React/TypeScript) : ouvrir une vidéo ou une série, analyser, vérifier et corriger les segments, exporter.

Elle ne contient aucune logique de détection ni de recalage : elle pilote le moteur Python (`../engine/`), lancé au démarrage comme processus séparé exposant une API HTTP + WebSocket locale (`127.0.0.1:8757`, 8756 étant celui de SyncAudio). Voir [`engine/README.md`](../engine/README.md).

## Prérequis

- [Node.js](https://nodejs.org/) (npm).
- [Rust](https://www.rust-lang.org/tools/install) (via [rustup](https://rustup.rs/)).
- [uv](https://docs.astral.sh/uv/), avec les dépendances du moteur synchronisées (`uv sync` dans `../engine/`) : en dev, le moteur est lancé par `uv run syncsubtitles serve` contre les sources.

## Développement

```
npm install
npm run tauri dev
```

Rechargement à chaud de l'interface ; le moteur démarre et s'arrête avec la fenêtre (voir `src-tauri/src/lib.rs`), mais ne se recharge pas : après une modification du moteur, relancer l'application.

`npm run dev` lance l'interface seule dans un navigateur. Avec un moteur lancé à part (`uv run syncsubtitles serve` dans `../engine/`), tout fonctionne sauf les dialogues natifs ; en dev, `window.__test.load(role, path)` ouvre un fichier sans dialogue, et un évènement `syncsubtitles:dragdrop` simule un glisser-déposer (vérifications automatiques avec Playwright).

## Vérifications

Elles tournent en local (GitHub Actions ne lance que les tests du moteur et le build, à la release : une vérification là-bas bloquerait la release tard).

```
npm run check              # types, formatage, lint, code mort : quelques secondes
npm run check -- --full    # + clippy et les tests du moteur : ~1 min (pas pendant `tauri dev`)
```

`scripts/check.mjs` enchaîne `tsc`, Prettier, ESLint (règles des hooks React), knip (exports et dépendances inutilisés), ruff (`check` et `format`) sur le moteur et `cargo fmt`. `npm run format` reformate l'app (Prettier), `uv run ruff format` le moteur, `cargo fmt` la coquille Rust. `npm install` active un hook pre-commit (`.githooks/pre-commit`) qui vérifie le formatage et le lint des seuls fichiers commités.

## Empaqueter (`tauri build`)

```
npm run tauri build
```

`beforeBuildCommand` construit l'interface, puis fige le moteur avec PyInstaller (`../engine/packaging/build_sidecar.py`, sauté si rien n'a changé depuis le dernier build) dans `src-tauri/binaries/syncsubtitles-engine/`, embarqué comme `engine/` à côté de l'exe. L'installateur Windows (NSIS, anglais et français) est écrit dans `src-tauri/target/release/bundle/nsis/`.

Un build local n'est pas signé pour les mises à jour sans la clé : définir `TAURI_SIGNING_PRIVATE_KEY` (contenu de `.tauri-keys/syncsubtitles.key`) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (vide).

## Publier une release

Le workflow `.github/workflows/release.yml` (repris de SyncAudio) :

- **sur un tag `vX.Y.Z`** : tests du moteur sous Windows et Linux, puis une release **brouillon** avec l'installateur `.exe`, le `.deb` et `latest.json` (mises à jour automatiques), signés ;
- **lancé à la main** (Actions > Release > Run workflow, sur n'importe quelle branche) : construit les deux installateurs sans rien publier, en artefacts du run.

Secrets requis (Settings > Secrets and variables > Actions) :

- `TAURI_SIGNING_PRIVATE_KEY` : le contenu de `app/.tauri-keys/syncsubtitles.key` (jamais commité) ;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : vide (clé générée sans mot de passe).

Pour une nouvelle version : changer la version dans `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` et `../engine/pyproject.toml`, merger, pousser le tag `vX.Y.Z`, relire puis publier le brouillon.
