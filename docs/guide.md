<p align="center">English | <a href="guide.fr.md">Français</a></p>

# User guide

This guide explains how to use Bobine Subs, from opening a video to exporting, for one file or a whole series. For installing it, see the [README](../README.md#install). The interface is in French: its labels are quoted below in French, with their meaning.

## Contents

1. [Words to know](#words-to-know)
2. [One file at a time](#one-file-at-a-time)
3. [Reading the result](#reading-the-result)
4. [Correcting the segments by hand](#correcting-the-segments-by-hand)
5. [Exporting](#exporting)
6. [A whole series](#a-whole-series)
7. [FAQ](#faq)

## Words to know

- **Reference** (*Référence*): the subtitles already in sync with the video, usually the original version's. They're never changed: they're the benchmark. Their language doesn't matter.
- **Subtitles to fix** (*À corriger*): the out-of-sync ones, say a French track downloaded separately. Bobine Subs retimes them onto the reference.
- **Offset** (*Décalage*): the gap between the two at a given moment. **+** means the subtitles to fix come **late**, **−** that they come **early**.
- **Segment**: a stretch of the video over which the offset follows one rule. Subtitles off by a fixed amount have one segment; a video edited differently (ad breaks, scenes added or cut) has several.
- **Constant, drift, jump**:
  - *constant*: the offset stays the same over the whole segment;
  - *drift*: it grows little by little, because the subtitles were made for another frame rate (25 fps instead of 23.976, for instance);
  - *jump*: it changes at once between two segments.
- **Confidence** (*Confiance*): the share of a segment's lines that land in front of reference lines, from 0 to 100 %. Under 80 %, the segment is flagged **⚠**: worth checking.

## One file at a time

That's the **Un fichier** mode, top left.

1. **Open the video** with *Ouvrir un fichier…*, or drop it on the window.
   - **Reference track** (*Piste de référence*): *Automatique* picks the fullest track, leaving forced tracks out. You can force one. Image subtitles (Blu-ray, DVD) can be a reference.
   - A reference can also be a well-timed SRT/ASS file, if that's all you have.
2. **Pick the subtitles to fix**:
   - *Piste de ce fichier*: another track of the same video (picked for you when the video holds two);
   - *Autre fichier*: an SRT/ASS file, or another video one of whose tracks will be used. Dropping an SRT/ASS file on the window does the same.
3. **Analyze** (*Analyser*): a few seconds. The *Journal* shows progress, *Annuler* stops it.

## Reading the result

- **At the top**, the summary: "constant offset of −1.060 s" or "5 jumps, 6 segments", a **drift** if any (*cible accélérée (23,976 -> 25 i/s, PAL)*: target sped up), and the reference used.
- **The curve** shows the offset along the video, one line per segment. The dashes under it show where lines are: the reference's above, the corrected ones below. An orange segment is unreliable.
- **The close-up**, under the curve, shows 10 s to 2 min of the video on three rows:
  - *Référence*: the reference's lines, with their text;
  - *Avant*: the subtitles to fix, as they are;
  - *Après*: the same once corrected.

  When all is well, each line of the *Après* row sits in front of the reference line saying the same thing. Click the curve to move the close-up, or use *Saut précédent / suivant* to visit each jump. Hover a line for its full text and times.
- **The segment table** gives each one's start and end, offset, number of lines and confidence.
- "*sans équivalent*" counts lines with no reference line in front of them: a line the translator added, a tag like `[FRENCH]`, a non-dialogue line (`[Music]`, lyrics…). They're retimed anyway, with their segment.

## Correcting the segments by hand

*✎ Modifier les segments* opens the editor, for when the detection got something wrong. Everything you do there shows at once in the close-up.

- **Drag a segment** up or down to change its offset.
- **Drag a handle ●** to move the boundary between two segments.
- **Split**: double-click the curve, or *✂ Couper ici* to split at the close-up's centre.
- **Align** (*Aligner*): the fastest way when a passage is visibly off. In the close-up, click a line of the *Après* row, then the reference line that says the same thing: its whole segment shifts so they start together.
- **The table** lets you type a boundary (`10:02.82`) or an offset in milliseconds. A drift has two offsets, at the segment's start and end.
- **Remove** (*Retirer*) deletes a segment (a false detection): its neighbour stretches over its time, with its own offset. *Retirer les segments peu fiables* does it for each ⚠ segment.
- **Undo / Redo** (Ctrl+Z / Ctrl+Y) and *Réinitialiser* (back to the detection).

*Enregistrer* keeps your segments: the result then reads *Modifié à la main*, and the export applies them as they are, without detecting anything again. *Annuler* or Escape closes the editor, asking first if you changed something.

## Exporting

- **New MKV** (*Nouveau MKV*): a copy of the video, nothing re-encoded.
  - When the track to fix comes from the video, the corrected track **replaces** the original, in the same place, with the same language and title.
  - When it comes from a separate file, it's **added**. Its language is guessed from the file name (`Film.fr.srt`, `episode-VF.srt` → French) or picked in the list; you can give it a title and make it the default track.
- **Subtitles only** (*Sous-titres seuls*): the corrected SRT/ASS file. In ASS, styles, positions and effects stay as they are: only the timing changes.
- By default the file goes next to the original, named `Film.synced.mkv`; *Parcourir…* to put it elsewhere. The app warns when a file with that name already exists.
- The original file is never changed. A cancelled export leaves no half-written file behind.
- Lines removed (that fell before the video's start, or in a scene it doesn't have) are listed once the export is done.

## A whole series

The **Série** mode, top left, handles several episodes at once. Two ways:

- **Videos + subtitles** (*Vidéos + sous-titres*): add the videos on one side (*+ Vidéos…*), the SRT/ASS files on the other (*+ Sous-titres…*), or drop them, folders included. Each subtitle file is matched to its episode by the **number in its name** (`S01E03`, `1x03`, `E03`, `Episode 3`…), even when the names differ. Files with no common number are matched in order, flagged *ordre*; the ↑↓ arrows swap two rows' subtitles if a match is wrong.
- **Multi-track videos** (*Vidéos multipistes*): videos that each hold the reference and the track to fix. Pick the **language** of the track to fix; videos without one are flagged.

Then:

1. *Analyser tout*: one episode after the other. Each row shows its summary, with *⚠ à vérifier* when a segment is unreliable or lines will be removed. Click the summary for the full details and, if needed, to **edit that episode's segments**.
2. *Exporter tout*, to the chosen output folder, or next to each file:
   - in another folder, each copy keeps the original's name (`My.Show.S01E03.mkv`) unless that name is taken;
   - next to the originals, it's `My.Show.S01E03.synced.mkv`;
   - with subtitles only, a separate file keeps its name, and a track taken from a video becomes `Film.fre.srt`, which players load on their own.

Once everything is done, the buttons become *Tout réanalyser* and *Tout réexporter*; each row also has its own *↻ Analyse* and *↻ Export* buttons.

## FAQ

**The analysis finds nothing good / confidence is low everywhere.**
The reference and the subtitles to fix probably don't hold the same lines: a forced track picked as reference, another episode's subtitles, or a very different version's. Check in the close-up that the lines look alike.

**A jump is in the wrong place, or a segment shouldn't be there.**
Open the editor: move the boundary, remove the segment, or use *Aligner* on a line of that passage.

**The subtitles were made for another frame rate.**
That's drift: it's detected and corrected on its own for the usual rates (23.976, 24, 25 fps), and shown in the summary.

**Can I retime PGS (Blu-ray) or VobSub (DVD) subtitles?**
Not yet: they can be a reference, but only text subtitles (SRT, ASS) can be retimed.

**Where did that line go?**
It may have fallen before the video's start, or in a scene the video doesn't have: the export lists every removed line, with its time.
