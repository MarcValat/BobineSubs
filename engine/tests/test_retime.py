from syncsubtitles.retime import Segment, segment_for
from syncsubtitles.server import SegmentModel


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
