"""The docs' demo series, synthetic as the tests' media (make_media.py): the
same random rhythm of lines, but lines of dialogue written here, readable in
the loupe, and episodes as long as a real one. Nothing copyrighted: no
timing or text taken from a real release.

Usage (from app/; e2e/docs.spec.ts runs it):
    uv run --project ../engine python e2e/make_demo.py [out_dir]

"My Show - S01E01..03.mkv": English (the reference) and French (to correct)
-- E01 three segments at two ad breaks, E02 a constant offset, E03 a PAL
drift; "My Show - S01E0n.fr.srt" for the pairs. Rewritten only when this
script or make_media.py changed.
"""

from __future__ import annotations

import hashlib
import random
import subprocess
import sys
import tempfile
from pathlib import Path

from make_media import NTSC, moved, write_subtitle

from syncsubtitles.ffmpeg_backend import resolve_ffmpeg

DURATION = 1560.0
NBSP = " "

# Where a reference line at t lands in the French (see make_media.MEDIA).
EPISODES = {
    "My Show - S01E01.mkv": (11, [(0.0, -1.06), (412.0, -0.53), (838.0, 0.22)]),
    "My Show - S01E02.mkv": (12, 1.2),
    "My Show - S01E03.mkv": (13, ("drift", NTSC / 25, 0.3)),
}
PAIRS = {
    "My Show - S01E01.fr.srt": (11, [(0.0, 0.7), (412.0, 1.9), (838.0, 1.4)]),
    "My Show - S01E02.fr.srt": (12, -0.6),
    "My Show - S01E03.fr.srt": (13, 0.45),
}

LINES = [
    ("Where were you last night?", "Tu étais où hier soir ?"),
    ("I told you, I was at work.", "Je te l'ai dit, j'étais au travail."),
    ("Until three in the morning?", "Jusqu'à trois heures du matin ?"),
    ("The store had an inventory.", "Le magasin faisait l'inventaire."),
    ("You could have called.", "Tu aurais pu appeler."),
    ("My phone was dead.", "Mon téléphone était à plat."),
    ("Again?", "Encore ?"),
    ("Look, I'm sorry.", "Écoute, je suis désolé."),
    ("Let's just go.", "Allons-y."),
    ("Fine.", "D'accord."),
    ("Did you see this letter?", "Tu as vu cette lettre ?"),
    ("It came this morning.", "Elle est arrivée ce matin."),
    ("Who is it from?", "De qui elle vient ?"),
    ("There's no name on it.", "Il n'y a pas de nom."),
    ("Open it.", "Ouvre-la."),
    ("Not here, people are watching.", "Pas ici, on nous regarde."),
    ("Since when do you care?", "Depuis quand ça te dérange ?"),
    ("Since today.", "Depuis aujourd'hui."),
    ("The train leaves at noon.", "Le train part à midi."),
    ("Then we have an hour.", "Alors on a une heure."),
    ("Take the blue bag.", "Prends le sac bleu."),
    ("Which one?", "Lequel ?"),
    ("The one by the door.", "Celui près de la porte."),
    ("Got it.", "Compris."),
    ("Are you coming or not?", "Tu viens ou pas ?"),
    ("Give me a minute.", "Donne-moi une minute."),
    ("We don't have a minute.", "On n'a pas une minute."),
    ("Then go without me.", "Alors pars sans moi."),
    ("I'm not leaving you here.", "Je ne te laisse pas ici."),
    ("Thank you.", "Merci."),
    ("Is that the new neighbour?", "C'est le nouveau voisin ?"),
    ("He moved in on Sunday.", "Il a emménagé dimanche."),
    ("He waved at me twice.", "Il m'a fait signe deux fois."),
    ("Maybe he likes you.", "Il t'aime bien, peut-être."),
    ("Maybe he's just polite.", "Ou il est juste poli."),
    ("Dinner's ready!", "À table !"),
    ("Five more minutes.", "Encore cinq minutes."),
    ("You said that an hour ago.", "Tu as dit ça il y a une heure."),
    ("Who ate the last piece of cake?", "Qui a mangé la dernière part de gâteau ?"),
    ("Don't look at me.", "Ne me regarde pas."),
    ("The car won't start.", "La voiture ne démarre pas."),
    ("Did you check the battery?", "Tu as vérifié la batterie ?"),
    ("Of course I did.", "Bien sûr que oui."),
    ("Call your brother, he'll know.", "Appelle ton frère, il saura."),
    ("I'd rather walk.", "Je préfère marcher."),
    ("It's raining.", "Il pleut."),
    ("Then I'll take an umbrella.", "Alors je prends un parapluie."),
    ("Good luck with the interview.", "Bonne chance pour l'entretien."),
    ("I'll need it.", "J'en aurai besoin."),
    ("You'll be great.", "Tu vas être parfait."),
]


def rhythm(seed: int) -> list[tuple[float, float]]:
    """The reference's lines over a whole episode (make_media.rhythm's)."""
    rng = random.Random(seed)
    cues = []
    t = rng.uniform(1.0, 3.0)
    while t < DURATION - 6:
        length = rng.uniform(0.8, 4.0)
        cues.append((round(t, 3), round(t + length, 3)))
        t += length + rng.uniform(0.2, 3.0)
    return cues


def typeset(text: str) -> str:
    """French typography, as a careful release has it: a no-break space
    before ? ! : ; (else the cleanup would fix every question)."""
    for mark in "?!:;":
        text = text.replace(f" {mark}", NBSP + mark)
    return text


def english(seed: int) -> list[tuple[float, float, str]]:
    return [(a, b, LINES[i % len(LINES)][0]) for i, (a, b) in enumerate(rhythm(seed))]


def french(seed: int, offset) -> list[tuple[float, float, str]]:
    """The same lines translated, a few dropped or merged, their edges a
    little off, then moved (make_media.translated's)."""
    rng = random.Random(seed * 7919)
    cues = rhythm(seed)
    out = []
    i = 0
    while i < len(cues):
        start, end = cues[i]
        text = typeset(LINES[i % len(LINES)][1])
        if rng.random() < 0.04:
            i += 1
            continue
        if i + 1 < len(cues) and rng.random() < 0.04:
            end = cues[i + 1][1]
            text = f"{text}\n{typeset(LINES[(i + 1) % len(LINES)][1])}"
            i += 1
        a = moved(start + rng.uniform(-0.04, 0.04), offset)
        b = moved(end + rng.uniform(-0.04, 0.04), offset)
        if a >= 0.05:
            out.append((round(a, 3), round(b, 3), text))
        i += 1
    return out


def make_episode(out_dir: Path, name: str, seed: int, offset, tmp: Path) -> None:
    ref, fre = tmp / f"{seed}-eng.srt", tmp / f"{seed}-fre.srt"
    write_subtitle(ref, english(seed), "srt")
    write_subtitle(fre, french(seed, offset), "srt")
    cmd = [
        resolve_ffmpeg(), "-v", "error", "-y",
        "-f", "lavfi", "-i", f"color=c=0x203048:s=160x90:r=1:d={DURATION}",
        "-i", str(ref), "-i", str(fre),
        "-map", "0:v", "-map", "1:s", "-map", "2:s",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "45", "-pix_fmt", "yuv420p",
        "-c:s", "srt",
        "-metadata:s:s:0", "language=eng", "-metadata:s:s:0", "title=English",
        "-metadata:s:s:1", "language=fre", "-metadata:s:s:1", "title=Français",
        "-t", str(DURATION), str(out_dir / name),
    ]  # fmt: skip
    subprocess.run(cmd, check=True)


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "media" / "demo"
    out_dir.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).parent
    stamp = hashlib.sha256((here / "make_demo.py").read_bytes() + (here / "make_media.py").read_bytes()).hexdigest()
    stamp_file = out_dir / "stamp.txt"
    names = [*EPISODES, *PAIRS]
    if stamp_file.exists() and stamp_file.read_text() == stamp and all((out_dir / n).exists() for n in names):
        print(f"demo up to date in {out_dir}")
        return
    with tempfile.TemporaryDirectory() as tmp:
        for name, (seed, offset) in EPISODES.items():
            make_episode(out_dir, name, seed, offset, Path(tmp))
            print(f"made {name}")
    for name, (seed, offset) in PAIRS.items():
        write_subtitle(out_dir / name, french(seed, offset), "srt")
        print(f"made {name}")
    stamp_file.write_text(stamp)


if __name__ == "__main__":
    main()
