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
npm run check              # types, formatage, lint, code mort, tests unitaires : quelques secondes
npm run check -- --full    # + clippy et les tests du moteur : ~1 min (pas pendant `tauri dev`)
```

`scripts/check.mjs` enchaîne `tsc` (l'app et les tests de bout en bout), Prettier, ESLint (règles des hooks React), knip (exports et dépendances inutilisés), les tests unitaires, ruff (`check` et `format`) sur le moteur et `cargo fmt`. `npm run format` reformate l'app (Prettier), `uv run ruff format` le moteur, `cargo fmt` la coquille Rust. `npm install` active un hook pre-commit (`.githooks/pre-commit`) qui vérifie le formatage et le lint des seuls fichiers commités.

Les tests unitaires (Vitest, `npm test`) couvrent la logique pure de l'interface, à côté de ce qu'ils testent (`src/*.test.ts`) : éditions de segments et leur historique, aperçu du recalage (le même calcul que `retime.py` du moteur), formats d'affichage.

### Tests de bout en bout

```
npm run test:e2e                                   # tout : ~7 min
npm run test:e2e -- e2e/workflows.spec.ts          # une suite
npm run test:e2e -- -g "pairs"                     # les tests dont le nom contient « pairs »
npx playwright show-report e2e/report              # le rapport du dernier passage (traces des échecs)
```

L'app dans Chromium, pilotée comme par un utilisateur (Playwright, `playwright.config.ts`), contre le vrai moteur. Vite et le moteur des tests sont les leurs, sur leurs propres ports (1430 et 8758 ; la page est dirigée vers le moteur par `?enginePort=8758`), démarrés pour le passage puis arrêtés : jamais ceux de `tauri dev` (1420 et 8757), qui peut tourner sur un code plus ancien et qu'on peut lancer ou fermer pendant les tests.

Les médias sont **synthétiques** (`e2e/make_media.py`, quelques secondes, refaits seulement quand le script change, dans `e2e/media/`, ignoré par git) : des MKV de 10 min dont la piste de référence (anglais) suit un rythme de répliques, et la piste à corriger (français) les mêmes répliques — quelques-unes perdues ou fusionnées, leurs bords un peu décalés, comme une traduction — déplacées d'une valeur connue : un décalage, un saut, une dérive PAL ; et des SRT à part pour les paires, nommés d'après leur épisode (ou non). Les tests vérifient que l'analyse retrouve ces défauts.

| Suite | Ce qu'elle vérifie |
|---|---|
| `workflows` | les deux modes de bout en bout : décalage, saut et dérive retrouvés, un SRT ajouté à une vidéo à la place de sa piste, les paires (par épisode ou signalées « ordre », Remplacer / ajoutée), sous-titres seuls ; exports relus (pistes, langues, titres) et leurs répliques là où sont celles de la référence |
| `editor` | l'éditeur de segments : couper (double-clic, « Couper ici »), défaire / refaire (touches et boutons), réinitialiser, question avant d'abandonner, Aligner, courbe et loupe zoomées ensemble, barre de navigation, l'export suit ce qui est enregistré |
| `ui` | la liste (flèches, déplacer, retirer, « Tout retirer », repli retenu), mode / thème / langue retenus, un fichier illisible, « Analyser tout » qui attend la lecture des pistes, les onglets d'une fenêtre basse, les options d'export |
| `layout` | chaque écran à 1024×640 et 1440×900, deux thèmes, deux langues : icônes centrées au pixel, hauteurs entières, arrondis concentriques, texte coupé ou hors fenêtre, boutons voisins, contraste 4,5:1 (mesuré contre la pire couleur des dégradés) |
| `a11y` | accessibilité (axe-core, WCAG 2.1 A / AA) des écrans et dialogues |
| `visual` | les écrans principaux comparés à des captures de référence, enregistrées au premier passage sur chaque système (`e2e/__screenshots__/<système>`, hors git : polices et rendu diffèrent) ; après un changement voulu, `npm run test:e2e -- e2e/visual.spec.ts --update-snapshots` (une différence de moins de 0,2 % des pixels passe sans réécrire la capture : la supprimer pour la refaire) |
| `docs` | pas un test : les captures de la documentation (`docs/screenshots`), deux langues, deux thèmes, sur une série de démonstration synthétique (`e2e/make_demo.py` : des épisodes de 26 min, des répliques écrites pour l'occasion, rien de protégé) ; seulement sur demande : `DOCS=1 npm run test:e2e -- e2e/docs.spec.ts` (PowerShell : `$env:DOCS=1; npm run test:e2e -- e2e/docs.spec.ts`) |

Chaque test échoue aussi sur une erreur du moteur (HTTP 4xx/5xx), de la page ou de la console, ou un export laissé à côté des médias. Hors de portée : la vraie fenêtre Tauri (barre de titre, dialogues natifs, WebView2 / WebKitGTK).

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
