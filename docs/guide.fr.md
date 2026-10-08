<p align="center"><a href="guide.md">English</a> | Français</p>

# Guide d'utilisation

Ce guide explique comment utiliser Bobine Subs, de l'ouverture d'une vidéo à l'export, pour un fichier comme pour une série entière. Pour l'installation, voir le [README](../README.fr.md#installation).

## Sommaire

1. [Les mots à connaître](#les-mots-à-connaître)
2. [Un fichier à la fois](#un-fichier-à-la-fois)
3. [Lire le résultat](#lire-le-résultat)
4. [Corriger les segments à la main](#corriger-les-segments-à-la-main)
5. [Exporter](#exporter)
6. [Une série entière](#une-série-entière)
7. [Options](#options)
8. [Questions fréquentes](#questions-fréquentes)

## Les mots à connaître

- **Référence** : les sous-titres déjà bien calés sur la vidéo, en général ceux de la version originale. Ils ne sont jamais modifiés : c'est eux qui servent de repère. Leur langue n'a pas d'importance.
- **Sous-titres à corriger** : ceux qui sont décalés, par exemple une VF récupérée à part. C'est eux que Bobine Subs recale sur la référence.
- **Décalage** : l'écart entre les deux à un instant donné. **+** veut dire que les sous-titres à corriger arrivent **en retard** sur la référence, **−** qu'ils arrivent **en avance**.
- **Segment** : un morceau de la vidéo sur lequel le décalage suit une même règle. Des sous-titres décalés d'un bloc n'ont qu'un segment ; une vidéo montée différemment (coupures pub, scènes en plus ou en moins) en a plusieurs.
- **Constant, dérive, saut** :
  - *constant* : le décalage reste le même sur tout le segment ;
  - *dérive* : il grandit peu à peu, parce que les sous-titres ont été faits pour une autre cadence d'images (25 i/s au lieu de 23,976, par exemple) ;
  - *saut* : il change d'un coup entre deux segments.
- **Confiance** : la part des répliques d'un segment qui tombent bien en face de répliques de la référence, de 0 à 100 %. En dessous de 80 %, le segment est signalé **⚠** : à vérifier.

## Un fichier à la fois

C'est le mode **Fichier unique**, en haut à gauche.

1. **Ouvre la vidéo** avec « Ouvrir un fichier », ou dépose-la sur la fenêtre. Le panneau **Pistes** liste ses pistes de sous-titres (survole une ligne pour voir son titre ; **(F)** signale des sous-titres forcés). Une référence peut aussi être un fichier SRT/ASS bien calé, si tu n'as que celui-là.
2. **Coche la référence** dans la colonne **Réf.** : une piste est cochée d'office (une piste complète plutôt que forcée, en texte plutôt qu'en image). Les sous-titres image (Blu-ray, DVD) peuvent servir de référence.
3. **Coche les sous-titres à corriger** dans la colonne **À corriger** : une autre piste de la même vidéo (cochée d'office quand la vidéo en contient deux), ou un fichier à part, ajouté avec « **+ Ajouter des sous-titres** » (un SRT/ASS, ou une autre vidéo dont on prendra une piste). Déposer un SRT/ASS sur la fenêtre fait la même chose.
4. **Analyser** : quelques secondes. Le **Journal** montre où en est l'analyse, et « Annuler » l'arrête.

## Lire le résultat

À droite, le panneau d'analyse a pour titre la piste corrigée et sa référence (« Piste @1 (fre) · référence @0 (eng) »).

- **En haut**, le résumé : « Décalage constant de −1,060 s » ou « 6 segments · 5 sauts », une éventuelle **dérive** (« Dérive : 23,976 -> 25 i/s »), et le nombre de répliques.
- **La courbe** montre le décalage le long de la vidéo, un trait par segment : **bleu** pour un décalage constant, **orange** pour une dérive, **en pointillés** (sur fond rougeâtre) pour un segment peu fiable. La légende est sous la courbe. Les tirets en dessous montrent où sont les répliques : celles de la référence au-dessus, celles corrigées en dessous.
- **La loupe**, sous la courbe, montre 10 s à 2 min de la vidéo sur trois lignes :
  - **Référence** : les répliques de la référence, avec leur texte ;
  - **Avant** : les sous-titres à corriger, tels qu'ils sont ;
  - **Après** : les mêmes une fois corrigés.

  Si tout va bien, chaque réplique de la ligne « Après » tombe en face de la réplique de référence qui dit la même chose. Clique sur la courbe pour déplacer la loupe, ou utilise « Aller à : Saut précédent / suivant » pour aller voir chaque saut. Passe la souris sur une réplique pour lire son texte complet et ses horaires.
- **Le tableau des segments** donne, pour chacun, son début et sa fin, son décalage (en orange pour une dérive, du début à la fin du segment), son nombre de répliques et sa **confiance**, en jauge : verte si le segment est fiable, rouge avec ⚠ s'il est à vérifier.
- « **sans équivalent** » compte les répliques qui n'ont pas de réplique en face dans la référence : une ligne ajoutée par le traducteur, une mention comme `[FRENCH]`, une réplique non dialoguée (`[Musique]`, paroles…). Elles sont recalées quand même, avec leur segment.

## Corriger les segments à la main

« Modifier les segments » ouvre l'éditeur (« Corriger manuellement les segments »), quand la détection s'est trompée quelque part. Tout ce que tu y fais se voit aussitôt dans la loupe.

- **Glisser un segment** vers le haut ou le bas change son décalage.
- **Glisser une poignée ●** déplace la frontière entre deux segments.
- **Couper** : double-clique sur la courbe, ou « ✂ Couper ici » pour couper au centre de la loupe.
- **Aligner** : le plus rapide quand on voit qu'un passage est décalé. Dans la loupe, clique une réplique de la ligne « Après », puis la réplique de référence qui dit la même chose : tout son segment se décale pour qu'elles commencent ensemble.
- **Le tableau** permet de saisir une frontière (`10:02.82`) ou un décalage en millisecondes, au début (« Décal. début ») et à la fin (« Décal. fin ») du segment : deux valeurs différentes en font une dérive.
- **Retirer** supprime un segment (une fausse détection) : son voisin s'étend sur sa durée, avec son propre décalage. « Retirer les segments peu fiables », en bas, le fait pour chaque segment ⚠.
- **Défaire / Refaire** (Ctrl+Z / Ctrl+Y) et **Réinitialiser** (revenir aux segments de l'ouverture), en bas à gauche.

« Enregistrer » garde tes segments : le résultat porte alors « Modifié à la main », et l'export les applique tels quels, sans rien redétecter. « Annuler » ou Échap ferme l'éditeur, en demandant d'abord si tu as fait des modifications.

## Exporter

Le panneau **Export**, sous les pistes, choisit ce qui est écrit :

- **Nouveau MKV** : une copie de la vidéo, rien n'est réencodé.
  - Quand la piste à corriger vient de la vidéo, la piste corrigée **remplace** l'originale, à la même place, avec la même langue et le même titre.
  - Quand elle vient d'un fichier à part, elle est **ajoutée**. Sa langue est celle du fichier (devinée d'après son nom : `Film.fr.srt`, `episode-VF.srt` → français), ou choisie dans la liste ; tu peux lui donner un titre et en faire la piste par défaut.
- **Sous-titres seuls** : le fichier SRT/ASS corrigé. En ASS, styles, positions et effets sont gardés tels quels : seuls les horaires changent.

« **Exporter le fichier synchronisé** » ouvre la fenêtre d'enregistrement, avec un nom proposé à côté de l'original (`Film.synced.mkv`) : valide-le, ou choisis un autre dossier ou un autre nom. « Contenu de l'export (?) » rappelle ce que contiendra le fichier.

- Le fichier d'origine n'est jamais modifié. Un export annulé ne laisse aucun fichier à moitié écrit.
- Une fois l'export fini, « Ouvrir le dossier » montre le fichier écrit, et les répliques retirées (tombées avant le début de la vidéo, ou dans une scène qu'elle n'a pas) sont listées.

## Une série entière

Le mode **Batch**, en haut à gauche, traite plusieurs épisodes d'un coup. Un clic dessus déroule ses deux façons de faire (la dernière utilisée est retenue) :

- **Fichiers multipistes** : des vidéos contenant chacune la référence et la piste à corriger. Choisis dans la barre de réglages la **langue de la piste à corriger** (« À corriger : »).
- **Paires de fichiers** : d'un côté les vidéos de référence, de l'autre ce qu'il faut corriger, un par épisode : des fichiers SRT/ASS, ou des vidéos dont on prendra une piste (choisie par langue, comme ci-dessus). Chaque fichier est associé à son épisode d'après le **numéro dans son nom** (`S01E03`, `1x03`, `E03`, `Episode 3`…), même si les noms sont différents. Ceux sans numéro commun sont associés dans l'ordre, signalés « ordre » ; les flèches ↑ ↓ corrigent l'ordre de la colonne « À corriger ».

Ajoute les fichiers avec « + Ajouter » en tête de colonne, ou dépose-les sur la fenêtre, dossiers compris (en paires : sur la moitié gauche pour les références, sur la droite pour ce qu'il faut corriger).

Dans la barre de réglages :

- **Référence** : « Automatique (la plus complète) », ou la langue de la piste de référence, pour tous les fichiers ;
- **Export** : « Nouveaux MKV » ou « Sous-titres seuls », et en paires la langue et le titre de la piste ajoutée.

« **Choisir** », sur une ligne, fixe à la main la référence et la piste à corriger de ce fichier, quand la règle par langue ne convient pas ; la ligne porte alors « (manuel) », et « Par langue » revient à la règle.

Puis :

1. **Analyser tout** : un épisode après l'autre ; ceux qui attendent leur tour sont « En attente ». Chaque ligne affiche son résumé, avec « ⚠ à vérifier » si un segment est peu fiable ou si des répliques seront retirées. **Modifier** ouvre l'éditeur de cet épisode, même pendant que les autres s'analysent ; l'icône ↻ réanalyse cette ligne seule.
2. **Exporter tout**, selon la **Sortie** choisie en bas (« à côté des originaux », ou « Choisir un dossier… ») :
   - dans un autre dossier, chaque copie garde le nom de l'original (`Ma.Serie.S01E03.mkv`), sauf si ce nom est déjà pris ;
   - à côté des originaux, c'est `Ma.Serie.S01E03.synced.mkv` ;
   - en « Sous-titres seuls », un fichier à part garde son nom, et une piste extraite d'une vidéo devient `Film.fre.srt`, que les lecteurs chargent tout seuls.

   L'icône de dossier, au bout de la ligne, ouvre le dossier du fichier écrit.

Une barre de couleur à gauche de chaque ligne dit où elle en est : bleue en cours, bleu pâle en attente, vert pâle analysée, verte exportée, rouge en erreur. Une fois tout analysé, le bouton devient « Tout réanalyser » (qui perd les modifications faites avec « Modifier »).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/batch-dark.png">
  <img src="screenshots/batch-light.png" alt="Le mode Batch : le tiroir Fichiers multipistes / Paires de fichiers, la barre de réglages, le tableau des épisodes analysés">
</picture>

## Options

Le bouton ⚙, en haut à droite, règle le **thème** (celui du système, clair ou sombre) et la **vérification des mises à jour** au démarrage.

## Questions fréquentes

**L'analyse ne trouve rien de bon / la confiance est basse partout.**
La référence et les sous-titres à corriger ne contiennent sans doute pas les mêmes répliques : piste forcée choisie comme référence, sous-titres d'un autre épisode, ou d'une version très différente. Vérifie dans la loupe que les répliques se ressemblent.

**Un saut est au mauvais endroit, ou un segment n'a pas lieu d'être.**
Ouvre l'éditeur : déplace la frontière, retire le segment, ou utilise « Aligner » sur une réplique du passage concerné.

**Les sous-titres ont été faits pour une autre cadence.**
C'est la dérive : elle est détectée et corrigée d'office pour les cadences classiques (23,976, 24, 25 i/s), et indiquée dans le résumé.

**Puis-je recaler des sous-titres PGS (Blu-ray) ou VobSub (DVD) ?**
Pas encore : ils servent de référence, mais seuls les sous-titres texte (SRT, ASS) peuvent être recalés.

**Où est passée telle réplique ?**
Elle est peut-être tombée avant le début de la vidéo, ou dans une scène que la vidéo n'a pas : l'export liste chaque réplique retirée, avec son heure.
