from syncsubtitles.retime import Segment, remap_cues, retime, segment_for
from syncsubtitles.server import SegmentModel
from syncsubtitles.subformats import SRT, Cue, SubtitleDocument


def test_overlapping_spans_cut_at_the_middle():
    # Target spans [0, 10] and [8, 20]: the shared stretch 8..10 is cut at 9.
    a, b = Segment(0.0, 10.0, 0.0, 0.0), Segment(10.0, 20.0, -2.0, -2.0)
    assert segment_for(8.9, [a, b]) is a
    assert segment_for(9.0, [a, b]) is b


def test_a_gap_between_spans_drops_its_cues():
    # Target spans [0, 10] and [12, 22]: a scene only the target has.
    a, b = Segment(0.0, 10.0, 0.0, 0.0), Segment(10.0, 20.0, 2.0, 2.0)
    assert segment_for(10.0, [a, b]) is a
    assert segment_for(11.0, [a, b]) is None
    assert segment_for(12.0, [a, b]) is b


def test_before_the_first_and_after_the_last_segment():
    a, b = Segment(5.0, 10.0, 0.0, 0.0), Segment(10.0, 20.0, 0.0, 0.0)
    assert segment_for(1.0, [a, b]) is a
    assert segment_for(30.0, [a, b]) is b


def test_a_boundary_fixed_by_hand_keeps_its_cues():
    # Cut by hand at 10 (target 10), then the second segment moved 5 s
    # earlier: its span now starts at 5, yet the cues before 10 stay first's.
    a, b = Segment(0.0, 10.0, 0.0, 0.0), Segment(10.0, 20.0, -5.0, -5.0, target_cut=(10.0, 10.0))
    assert segment_for(7.0, [a, b]) is a
    assert segment_for(10.0, [a, b]) is b
    # A fixed gap stays one.
    c = Segment(10.0, 20.0, -5.0, -5.0, target_cut=(10.0, 12.0))
    assert segment_for(11.0, [a, c]) is None


def test_the_api_carries_a_fixed_boundary():
    seg = SegmentModel(
        start_s=10.0, end_s=20.0, offset_start=-5.0, offset_end=-5.0, target_cut=(10.0, 10.0)
    ).to_segment()
    assert seg.target_cut == (10.0, 10.0)
    assert SegmentModel.of(seg).target_cut == (10.0, 10.0)
    assert SegmentModel(start_s=0.0, end_s=1.0, offset_start=0.0, offset_end=0.0).to_segment().target_cut is None


def test_lines_kept_or_taken_out_by_hand():
    """A line in a gap (only the target has that scene) is dropped, unless
    kept: then through the nearest segment; any line taken out by hand goes."""
    a, b = Segment(0.0, 10.0, 0.0, 0.0), Segment(10.0, 20.0, 2.0, 2.0)
    doc = SubtitleDocument(SRT, [Cue(1.0, 2.0, "un"), Cue(10.6, 11.0, "trou"), Cue(15.0, 16.0, "deux")])
    assert remap_cues(doc, [a, b]) == [(1.0, 2.0), None, (13.0, 14.0)]
    # Kept: the gap's line nearer the first segment's span (it ends at 10).
    assert remap_cues(doc, [a, b], keep={1}) == [(1.0, 2.0), (10.6, 11.0), (13.0, 14.0)]
    assert remap_cues(doc, [a, b], drop={0}) == [None, None, (13.0, 14.0)]
    # Taken out wins over kept.
    assert remap_cues(doc, [a, b], keep={1}, drop={1})[1] is None
    assert [c.text for c in retime(doc, [a, b], keep={1}, drop={2}).cues] == ["un", "trou"]


def test_lines_timed_by_hand():
    """A line given its times by hand keeps them (in reference time), even
    in a gap; taken out by hand, it goes all the same."""
    a, b = Segment(0.0, 10.0, 0.0, 0.0), Segment(10.0, 20.0, 2.0, 2.0)
    doc = SubtitleDocument(SRT, [Cue(1.0, 2.0, "un"), Cue(10.6, 11.0, "trou"), Cue(15.0, 16.0, "deux")])
    timing = {0: (1.5, 3.0), 1: (9.0, 9.8)}
    assert remap_cues(doc, [a, b], timing=timing) == [(1.5, 3.0), (9.0, 9.8), (13.0, 14.0)]
    assert remap_cues(doc, [a, b], drop={1}, timing=timing)[1] is None
    # Moved past the next line: retime keeps the lines' order, the export
    # sorts them (see service._retimed).
    assert [(c.start, c.end) for c in retime(doc, [a, b], timing={0: (14.0, 15.0)}).cues] == [
        (14.0, 15.0),
        (13.0, 14.0),
    ]
