import pytest

from syncsubtitles.languages import guess_language


@pytest.mark.parametrize(
    ("name", "lang"),
    [
        ("Film.fr.srt", "fre"),
        ("test-vf.srt", "fre"),
        ("S01E01.English.ass", "eng"),
        ("episode.srt", None),
        ("Frenchie.srt", None),
    ],
)
def test_guess_language(name, lang):
    assert guess_language(name) == lang
