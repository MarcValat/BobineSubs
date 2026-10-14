import pytest

from syncsubtitles.cleanup import MIN_DURATION_S, clean
from syncsubtitles.subformats import ASS, SRT, Cue, SubtitleDocument, parse

NBSP = " "


def _texts(texts, language="fre"):
    cues = [Cue(10.0 * i, 10.0 * i + 2.0, t) for i, t in enumerate(texts)]
    document, fixed = clean(SubtitleDocument(SRT, cues), language)
    return [c.text for c in document.cues], fixed


def test_reading_an_srt_turns_typed_line_breaks_into_real_ones():
    srt = "1\n00:00:01,000 --> 00:00:02,000\n- Une de nous doit faire la lessive.\\N - Pourquoi ?\n"
    assert parse(srt, SRT).cues[0].text == "- Une de nous doit faire la lessive.\n- Pourquoi ?"


def test_reading_an_srt_takes_a_colon_before_the_milliseconds():
    # It used to glue the line onto the previous one's text.
    srt = "1\n00:01:10,000 --> 00:01:12,000\nAvant\n\n2\n00:01:17:950 --> 00:01:18:500\nApres\n"
    cues = parse(srt, SRT).cues
    assert [(c.text, c.start) for c in cues] == [("Avant", 70.0), ("Apres", 77.95)]


def test_reading_an_srt_leaves_out_lines_with_nothing_to_show():
    srt = "1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\nBonjour\n"
    assert [c.text for c in parse(srt, SRT).cues] == ["Bonjour"]


def test_spaces_dashes_and_glued_sentences():
    texts, fixed = _texts(
        [
            "Mais tout le monde sait  que celles-ci ",
            "- Sookie!\n-Ca va, je vais bien.",
            "- Je faisais juste ...\n- ...de Chilton.",
            "Non, merci à vous.Ca a été un plaisir.",
        ],
        language="eng",
    )
    assert texts == [
        "Mais tout le monde sait que celles-ci",
        "- Sookie!\n- Ca va, je vais bien.",
        "- Je faisais juste...\n- ...de Chilton.",
        "Non, merci à vous. Ca a été un plaisir.",
    ]
    assert fixed["dashes"] == 1 and fixed["glued"] == 1 and fixed["spaces"] == 2


def test_french_punctuation_gets_a_no_break_space_before_it():
    texts, _ = _texts(["- De quoi j'ai l'air? D'une coréenne ?\n- Un toast : à Rory!", "Il est 7:10 !"])
    assert texts == [
        f"- De quoi j'ai l'air{NBSP}? D'une coréenne{NBSP}?\n- Un toast{NBSP}: à Rory{NBSP}!",
        f"Il est 7:10{NBSP}!",
    ]


def test_other_languages_have_no_space_before_punctuation():
    texts, _ = _texts(["What ? Really !", "?! Who"], language="eng")
    assert texts == ["What? Really!", "?! Who"]


def test_unknown_language_keeps_the_spaces_before_punctuation_as_they_are():
    texts, _ = _texts(["Quoi ? Vraiment!"], language=None)
    assert texts == ["Quoi ? Vraiment!"]


def test_apostrophes_follow_the_files_own_habit():
    texts, fixed = _texts(["J'ai l’air petite", "C'est l'heure", "D'accord"])
    assert texts == ["J'ai l'air petite", "C'est l'heure", "D'accord"]
    assert fixed["apostrophes"] == 1


@pytest.mark.parametrize(
    ("text", "kept"),
    [
        ("www.forom.com", None),
        ('<font color="#ffff00" size=14>www.tvsubtitles.net</font>', None),
        ("Adaptation et sous-titrage : Sulina\nwww.forom.com", f"Adaptation et sous-titrage{NBSP}: Sulina"),
        ("Visitez www.site.net", None),
        # Lines of dialogue naming a site stay.
        ("C'est sur amazon.com, je te dis", "C'est sur amazon.com, je te dis"),
        ("Va sur www.google.com et cherche son nom", "Va sur www.google.com et cherche son nom"),
    ],
)
def test_ads_go_the_translators_credit_stays(text, kept):
    texts, fixed = _texts([text])
    assert texts == ([kept] if kept else [])
    assert fixed["ads"] == (0 if kept else 1)


def test_timing_overlaps_and_short_and_inverted_lines():
    cues = [
        Cue(0.0, 2.5, "chevauche la suivante"),
        Cue(2.0, 2.2, "trop courte"),
        Cue(10.0, 9.9, "fin avant le début"),
        Cue(20.0, 20.1, "courte, la suivante tout près"),
        Cue(20.4, 22.0, "suivante"),
    ]
    document, fixed = clean(SubtitleDocument(SRT, cues), "fre")
    assert [(c.start, c.end) for c in document.cues] == [
        (0.0, 2.0),
        (2.0, 2.0 + MIN_DURATION_S),
        (10.0, 10.0 + MIN_DURATION_S),
        (20.0, 20.4),
        (20.4, 22.0),
    ]
    assert fixed == {"overlaps": 1, "short": 2, "inverted": 1}


def test_ass_is_left_as_it_is():
    document = SubtitleDocument(ASS, [Cue(0.0, 0.1, "a  b", "Default")])
    assert clean(document, "fre") == (document, {})


def test_a_standalone_export_is_cleaned_unless_told_not_to(tmp_path):
    from syncsubtitles.retime import Segment
    from syncsubtitles.service import write_result
    from syncsubtitles.tracks import parse_track_spec

    src = tmp_path / "Film.fr.srt"
    src.write_text(
        "1\n00:00:01,000 --> 00:00:03,000\n-Bonjour  toi?\n\n2\n00:00:05,000 --> 00:00:07,000\nwww.forom.com\n", "utf-8"
    )
    target = parse_track_spec(str(src))
    segments = [Segment(0.0, 100.0, 0.0, 0.0)]
    cleaned = write_result(target, target, segments, str(tmp_path / "a.srt"), True)
    assert (tmp_path / "a.srt").read_text("utf-8") == f"1\n00:00:01,000 --> 00:00:03,000\n- Bonjour toi{NBSP}?\n"
    assert cleaned.cleaned == {"dashes": 1, "spaces": 1, "punctuation": 1, "ads": 1}
    kept = write_result(target, target, segments, str(tmp_path / "b.srt"), True, clean=False)
    assert "-Bonjour  toi?" in (tmp_path / "b.srt").read_text("utf-8")
    assert kept.cleaned == {}
