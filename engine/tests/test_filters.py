import numpy as np
import pytest
from synthetic import dialogue_cues, edited, translated

from syncsubtitles.filters import dialogue_indices, is_dialogue
from syncsubtitles.retime import retime
from syncsubtitles.segments import detect_segments
from syncsubtitles.subformats import SRT, Cue, SubtitleDocument


@pytest.mark.parametrize(
    "text",
    ["[FRENCH]", "(rires)", "♪ La la la ♪", "♪", "<i>[Musique]</i>", "- [Bruit de pas]\n- (Soupir)", "{\\an8}[Applause]"],
)
def test_sound_descriptions_and_music_are_not_dialogue(text):
    assert not is_dialogue(Cue(0, 1, text))


@pytest.mark.parametrize(
    "text", ["Salut.", "- [Musique]\n- Tu as vu ?", "{\\i1}Hi, my name is Chuck.{\\i0}", "Oh (well) yes", "Ok"]
)
def test_spoken_lines_are_dialogue(text):
    assert is_dialogue(Cue(0, 1, text))


@pytest.mark.parametrize(
    ("style", "text", "dialogue"),
    [
        ("Default", "Hello", True),
        ("Main - Italics", "Hello", True),
        ("Signs", "BUY MORE", False),
        ("OP Romaji", "Sora ni", False),
        ("ED_English", "The sky", False),
        ("Default", "{\\k20}Ka{\\k30}ra", False),
        ("Default", "{\\p1}m 0 0 l 100 0 100 100", False),
        ("Opera singer", "Hello", True),
    ],
)
def test_ass_signs_songs_and_drawings(style, text, dialogue):
    assert is_dialogue(Cue(0, 1, text, style)) is dialogue


def test_image_cues_have_no_text_to_judge():
    assert is_dialogue(Cue(0, 1, ""))


def test_filtering_that_would_drop_most_cues_is_not_applied():
    cues = [Cue(i, i + 1, "x", "Signs") for i in range(10)] + [Cue(20, 21, "Hello", "Default")]
    assert dialogue_indices(cues) == list(range(11))


def test_sdh_only_lines_are_ignored_for_sync_but_still_retimed():
    ref_cues = dialogue_cues(1800.0)
    target = edited(translated(ref_cues, 1.5), [(900.0, -0.7)])
    # Sound descriptions only the target has, in the reference's silences.
    rng = np.random.default_rng(5)
    sdh = []
    for a, b in zip(target, target[1:]):
        if b.start - a.end > 3.0 and rng.random() < 0.6:
            sdh.append(Cue(a.end + 0.5, b.start - 0.5, "[Musique]"))
    target = sorted(target + sdh, key=lambda c: c.start)
    assert len(sdh) > 20

    detection = detect_segments(SubtitleDocument(SRT, ref_cues), SubtitleDocument(SRT, target))
    assert len(detection.segments) == 2
    corrected = retime(SubtitleDocument(SRT, target), detection.segments)
    assert sum(c.text == "[Musique]" for c in corrected.cues) == len(sdh)
    truth = {c.text: c.start for c in ref_cues}
    errors = np.array([c.start - truth[c.text] for c in corrected.cues if c.text in truth])
    assert abs(np.median(errors)) < 0.03
