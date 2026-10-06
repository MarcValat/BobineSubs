<p align="center"><a href="guide.md">English</a> | Français</p>

# Guide d'utilisation

Ce guide explique comment utiliser SyncSubtitles, de l'ouverture d'une vidéo à l'export, pour un fichier comme pour une série entière. Pour l'installation, voir le [README](../README.fr.md#installation).

## Sommaire

1. [Les mots à connaître](#les-mots-à-connaître)
2. [Un fichier à la fois](#un-fichier-à-la-fois)
3. [Lire le résultat](#lire-le-résultat)
4. [Corriger les segments à la main](#corriger-les-segments-à-la-main)
5. [Exporter](#exporter)
6. [Une série entière](#une-série-entière)
7. [Questions fréquentes](#questions-fréquentes)

## Les mots à connaître

- **Référence** : les sous-titres déjà bien calés sur la vidéo, en général ceux de la version originale. Ils ne sont jamais modifiés : c'est eux qui servent de repère. Leur langue n'a pas d'importance.
- **Sous-titres à corriger** : ceux qui sont décalés, par exemple une VF récupérée à part. C'est eux que SyncSubtitles recale sur la référence.
- **Décalage** : l'écart entre les deux à un instant donné. **+** veut dire que les sous-titres à corriger arrivent **en retard** sur la référence, **−** qu'ils arrivent **en avance**.
- **Segment** : un morceau de la vidéo sur lequel le décalage suit une même règle. Des sous-titres décalés d'un bloc n'ont qu'un segment ; une vidéo montée différemment (coupures pub, scènes en plus ou en moins) en a plusieurs.
- **Constant, dérive, saut** :
  - *constant* : le décalage reste le même sur tout le segment ;
  - *dérive* : il grandit peu à peu, parce que les sous-titres ont été faits pour une autre cadence d'images (25 i/s au lieu de 23,976, par exemple) ;
  - *saut* : il change d'un coup entre deux segments.
- **Confiance** : la part des répliques d'un segment qui tombent bien en face de répliques de la référence, de 0 à 100 %. En dessous de 80 %, le segment est signalé **⚠** : à vérifier.

## Un fichier à la fois

C'est le mode **Un fichier**, en haut à gauche.

1. **Ouvre la vidéo** avec « Ouvrir un fichier… », ou dépose-la sur la fenêtre.
   - **Piste de référence** : « Automatique » choisit la piste la plus complète, en laissant de côté les pistes forcées. Tu peux en imposer une. Les sous-titres image (Blu-ray, DVD) peuvent servir de référence.
   - Une référence peut aussi être un fichier SRT/ASS bien calé, si tu n'as que celui-là.
2. **Choisis les sous-titres à corriger** :
   - **Piste de ce fichier** : une autre piste de la même vidéo (choisie d'office quand la vidéo en contient deux) ;
   - **Autre fichier** : un fichier SRT/ASS, ou une autre vidéo dont on prendra une piste. Déposer un SRT/ASS sur la fenêtre fait la même chose.
3. **Analyser** : quelques secondes. Le **Journal** montre où en est l'analyse, et « Annuler » l'arrête.

## Lire le résultat

- **En haut**, le résumé : « Décalage constant de −1,060 s » ou « 5 sauts, 6 segments », une éventuelle **dérive** (« cible accélérée (23,976 -> 25 i/s, PAL) »), et la référence choisie.
- **La courbe** montre le décalage le long de la vidéo, un trait par segment. Les tirets sous la courbe montrent où sont les répliques : celles de la référence au-dessus, celles corrigées en dessous. Un segment orange est peu fiable.
- **La loupe**, sous la courbe, montre 10 s à 2 min de la vidéo sur trois lignes :
  - **Référence** : les répliques de la référence, avec leur texte ;
  - **Avant** : les sous-titres à corriger, tels qu'ils sont ;
  - **Après** : les mêmes une fois corrigés.

  Si tout va bien, chaque réplique de la ligne « Après » tombe en face de la réplique de référence qui dit la même chose. Clique sur la courbe pour déplacer la loupe, ou utilise « Saut précédent / suivant » pour aller voir chaque saut. Passe la souris sur une réplique pour lire son texte complet et ses horaires.
- **Le tableau des segments** donne, pour chacun, son début et sa fin, son décalage, son nombre de répliques et sa confiance.
- « **sans équivalent** » compte les répliques qui n'ont pas de réplique en face dans la référence : une ligne ajoutée par le traducteur, une mention comme `[FRENCH]`, une réplique non dialoguée (`[Musique]`, paroles…). Elles sont recalées quand même, avec leur segment.

## Corriger les segments à la main

« ✎ Modifier les segments » ouvre l'éditeur, quand la détection s'est trompée quelque part. Tout ce que tu y fais se voit aussitôt dans la loupe.

- **Glisser un segment** vers le haut ou le bas change son décalage.
- **Glisser une poignée ●** déplace la frontière entre deux segments.
- **Couper** : double-clique sur la courbe, ou « ✂ Couper ici » pour couper au centre de la loupe.
- **Aligner** : le plus rapide quand on voit qu'un passage est décalé. Dans la loupe, clique une réplique de la ligne « Après », puis la réplique de référence qui dit la même chose : tout son segment se décale pour qu'elles commencent ensemble.
- **Le tableau** permet de saisir une frontière (`10:02.82`) ou un décalage en millisecondes. Une dérive a deux décalages, au début et à la fin du segment.
- **Retirer** supprime un segment (une fausse détection) : son voisin s'étend sur sa durée, avec son propre décalage. « Retirer les segments peu fiables » le fait pour chaque segment ⚠.
- **Défaire / Refaire** (Ctrl+Z / Ctrl+Y) et **Réinitialiser** (revenir à la détection).

« Enregistrer » garde tes segments : le résultat porte alors « Modifié à la main », et l'export les applique tels quels, sans rien redétecter. « Annuler » ou Échap ferme l'éditeur, en demandant d'abord si tu as fait des modifications.

## Exporter

- **Nouveau MKV** : une copie de la vidéo, rien n'est réencodé.
  - Quand la piste à corriger vient de la vidéo, la piste corrigée **remplace** l'originale, à la même place, avec la même langue et le même titre.
  - Quand elle vient d'un fichier à part, elle est **ajoutée**. Sa langue est devinée d'après le nom du fichier (`Film.fr.srt`, `episode-VF.srt` → français), ou choisie dans la liste ; tu peux lui donner un titre et en faire la piste par défaut.
- **Sous-titres seuls** : le fichier SRT/ASS corrigé. En ASS, styles, positions et effets sont gardés tels quels : seuls les horaires changent.
- Par défaut, le fichier va à côté de l'original, nommé `Film.synced.mkv` ; « Parcourir… » pour le mettre ailleurs. L'application prévient si un fichier du même nom existe déjà.
- Le fichier d'origine n'est jamais modifié. Un export annulé ne laisse aucun fichier à moitié écrit.
- Les répliques retirées (tombées avant le début de la vidéo, ou dans une scène qu'elle n'a pas) sont listées une fois l'export fini.

## Une série entière

Le mode **Série**, en haut à gauche, traite plusieurs épisodes d'un coup. Deux façons de faire :

- **Vidéos + sous-titres** : ajoute les vidéos d'un côté (« + Vidéos… »), les fichiers SRT/ASS de l'autre (« + Sous-titres… »), ou dépose-les, dossiers compris. Chaque fichier de sous-titres est associé à son épisode d'après le **numéro dans son nom** (`S01E03`, `1x03`, `E03`, `Episode 3`…), même si les noms sont différents. Ceux sans numéro commun sont associés dans l'ordre, signalés « ordre » ; les flèches ↑↓ échangent les sous-titres de deux lignes en cas d'erreur.
- **Vidéos multipistes** : des vidéos contenant chacune la référence et la piste à corriger. Choisis la **langue** de la piste à corriger ; les vidéos qui n'en ont pas sont signalées.

Puis :

1. **Analyser tout** : un épisode après l'autre. Chaque ligne affiche son résumé, avec « ⚠ à vérifier » si un segment est peu fiable ou si des répliques seront retirées. Clique le résumé pour voir le détail complet et, au besoin, **modifier les segments** de cet épisode.
2. **Exporter tout**, dans le dossier de sortie choisi, ou à côté de chaque fichier :
   - dans un autre dossier, chaque copie garde le nom de l'original (`Ma.Serie.S01E03.mkv`), sauf si ce nom est déjà pris ;
   - à côté des originaux, c'est `Ma.Serie.S01E03.synced.mkv` ;
   - en « Sous-titres seuls », un fichier à part garde son nom, et une piste extraite d'une vidéo devient `Film.fre.srt`, que les lecteurs chargent tout seuls.

Une fois tout fait, les boutons deviennent « Tout réanalyser » et « Tout réexporter » ; chaque ligne a aussi ses boutons « ↻ Analyse » et « ↻ Export ».

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
