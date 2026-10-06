import pytest

from syncsubtitles.episodes import Pair, episode_key, pair_files


@pytest.mark.parametrize(
    ("name", "key"),
    [
        ("Chuck.S01E03.1080p.BluRay.x264.mkv", (1, 3)),
        ("chuck s1 e12 - Title.fr.srt", (1, 12)),
        ("Chuck - 1x03 - Chuck Versus the Tango.srt", (1, 3)),
        ("Show Episode 7.ass", (None, 7)),
        ("[Group] Show - 03 [1080p].mkv", (None, 3)),
        ("Show 12v2.ass", (None, 12)),
        ("Film (2024) 1080p.mkv", None),
        ("Show.2019.S02E10.720p.mkv", (2, 10)),
        ("movie.x264.mkv", None),
    ],
)
def test_episode_key(name, key):
    assert episode_key(name) == key


def test_pairs_by_episode_whatever_the_names_and_order():
    videos = ["D:/S/Chuck.S01E02.mkv", "D:/S/Chuck.S01E01.mkv", "D:/S/Chuck.S01E10.mkv"]
    subs = ["D:/dl/chuck 1x10.fr.srt", "D:/dl/chuck 1x01.fr.srt", "D:/dl/chuck 1x02.fr.srt"]
    assert pair_files(videos, subs) == [
        Pair("D:/S/Chuck.S01E01.mkv", "D:/dl/chuck 1x01.fr.srt", "episode"),
        Pair("D:/S/Chuck.S01E02.mkv", "D:/dl/chuck 1x02.fr.srt", "episode"),
        Pair("D:/S/Chuck.S01E10.mkv", "D:/dl/chuck 1x10.fr.srt", "episode"),
    ]


def test_a_missing_subtitle_does_not_shift_the_others():
    videos = ["E01.mkv", "E02.mkv", "E03.mkv"]
    subs = ["ep1.srt", "ep3.srt"]
    assert pair_files(videos, subs) == [
        Pair("E01.mkv", "ep1.srt", "episode"),
        Pair("E02.mkv", None, None),
        Pair("E03.mkv", "ep3.srt", "episode"),
    ]


def test_names_without_numbers_pair_by_order_and_extras_stay_alone():
    assert pair_files(["b.mkv", "a.mkv"], ["y.srt", "x.srt", "z.srt"]) == [
        Pair("a.mkv", "x.srt", "order"),
        Pair("b.mkv", "y.srt", "order"),
        Pair(None, "z.srt", None),
    ]


def test_season_is_respected_when_both_names_have_one():
    videos = ["Show.S01E01.mkv", "Show.S02E01.mkv"]
    subs = ["Show.S02E01.srt", "Show.S01E01.srt"]
    rows = pair_files(videos, subs)
    assert [(r.video, r.subtitle) for r in rows] == [
        ("Show.S01E01.mkv", "Show.S01E01.srt"),
        ("Show.S02E01.mkv", "Show.S02E01.srt"),
    ]
