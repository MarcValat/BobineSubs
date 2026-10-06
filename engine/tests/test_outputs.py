from pathlib import Path

from syncsubtitles.outputs import OutputName, plan_outputs


def mkv(source: Path) -> OutputName:
    return OutputName(source, f"{source.stem}.mkv", f"{source.stem}.synced.mkv")


def test_next_to_the_sources_it_is_the_synced_name(tmp_path):
    src = tmp_path / "Film.mkv"
    assert plan_outputs([mkv(src)], None) == [tmp_path / "Film.synced.mkv"]
    assert plan_outputs([mkv(src)], tmp_path) == [tmp_path / "Film.synced.mkv"]


def test_another_folder_keeps_the_original_name(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    sources = [tmp_path / "a" / "E01.mp4", tmp_path / "a" / "E02.mkv"]
    assert plan_outputs([mkv(s) for s in sources], out) == [out / "E01.mkv", out / "E02.mkv"]


def test_an_existing_file_or_another_export_is_never_overwritten(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (out / "E01.mkv").write_text("")
    # Two sources with the same name, from two folders.
    sources = [tmp_path / "a" / "E01.mkv", tmp_path / "b" / "E02.mkv", tmp_path / "c" / "E02.mkv"]
    assert plan_outputs([mkv(s) for s in sources], out) == [
        out / "E01.synced.mkv",
        out / "E02.mkv",
        out / "E02.synced.mkv",
    ]


def test_synced_names_are_numbered_when_they_clash(tmp_path):
    sources = [tmp_path / "a" / "E01.mkv", tmp_path / "b" / "E01.mkv", tmp_path / "c" / "E01.mkv"]
    for s in sources:
        s.parent.mkdir()
    (tmp_path / "out").mkdir()
    (tmp_path / "out" / "E01.mkv").write_text("")
    assert plan_outputs([mkv(s) for s in sources], tmp_path / "out") == [
        tmp_path / "out" / "E01.synced.mkv",
        tmp_path / "out" / "E01.synced (2).mkv",
        tmp_path / "out" / "E01.synced (3).mkv",
    ]


def test_subtitle_files_keep_their_own_name(tmp_path):
    sub = tmp_path / "dl" / "show 1x01.fr.srt"
    name = OutputName(sub, sub.name, "show 1x01.fr.synced.srt")
    assert plan_outputs([name], tmp_path / "out") == [tmp_path / "out" / "show 1x01.fr.srt"]
