from syncsubtitles.subformats import ASS, SRT, Cue, decode_subtitle_bytes, format_for_path, parse


def shift(by):
    return lambda cue: (cue.start + by, cue.end + by)


SRT_TEXT = """1
00:00:01,500 --> 00:00:03,000
Hello

2
00:01:05,000 --> 00:01:07,250
Two
lines
"""

ASS_TEXT = """[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,71

[Events]
Format: Layer, Start, End, Style, Actor, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,a note
Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,Hello, world
Dialogue: 0,0:01:05.00,0:01:07.25,Signs,,0,0,0,,{\\an8}Sign
"""


def test_srt_parse_and_roundtrip():
    doc = parse(SRT_TEXT, SRT)
    assert doc.cues == [Cue(1.5, 3.0, "Hello"), Cue(65.0, 67.25, "Two\nlines")]
    assert parse(doc.to_text(), SRT).cues == doc.cues


def test_srt_tolerates_crlf_dot_separator_and_short_fraction():
    doc = parse("1\r\n00:00:01.5 --> 00:00:02,25\r\nHi\r\n", SRT)
    assert doc.cues == [Cue(1.5, 2.25, "Hi")]


def test_srt_retime_shifts_and_drops_cues_before_zero():
    doc = parse(SRT_TEXT, SRT).retimed(shift(-2.0))
    assert doc.cues == [Cue(0.0, 1.0, "Hello"), Cue(63.0, 65.25, "Two\nlines")]
    doc = parse(SRT_TEXT, SRT).retimed(shift(-10.0))
    assert [c.text for c in doc.cues] == ["Two\nlines"]
    assert doc.to_text().startswith("1\n00:00:55,000")


def test_ass_retime_only_touches_dialogue_timing():
    doc = parse(ASS_TEXT, ASS)
    assert [(c.start, c.end, c.style) for c in doc.cues] == [(1.5, 3.0, "Default"), (65.0, 67.25, "Signs")]
    assert doc.cues[0].text == "Hello, world"
    out = doc.retimed(shift(+0.5)).to_text()
    assert "Dialogue: 0,0:00:02.00,0:00:03.50,Default,,0,0,0,,Hello, world" in out
    assert "Dialogue: 0,0:01:05.50,0:01:07.75,Signs,,0,0,0,,{\\an8}Sign" in out
    assert "Comment: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,a note" in out
    assert "Style: Default,Arial,71" in out


def test_ass_retime_drops_lines_before_zero_and_can_retime_again():
    doc = parse(ASS_TEXT, ASS).retimed(shift(-10.0))
    assert len(doc.cues) == 1
    assert "Hello, world" not in doc.to_text()
    again = doc.retimed(shift(+1.0)).to_text()
    assert "Dialogue: 0,0:00:56.00,0:00:58.25,Signs" in again


def test_decoding_falls_back_to_cp1252():
    assert decode_subtitle_bytes("Ça été".encode("cp1252")) == "Ça été"
    assert decode_subtitle_bytes((chr(0xFEFF) + "Ça").encode("utf-8")) == "Ça"


def test_format_detection():
    assert format_for_path("a.SRT") == SRT
    assert format_for_path("a.ssa") == ASS
    assert format_for_path("a.txt", ASS_TEXT) == ASS
    assert format_for_path("a.txt", SRT_TEXT) == SRT
