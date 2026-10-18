import numpy as np
import pytest
from synthetic import dialogue_cues, edited, translated

from syncsubtitles.retime import retime
from syncsubtitles.segments import STANDARD_RATIOS, detect_segments
from syncsubtitles.subformats import SRT, Cue, SubtitleDocument

PAL = STANDARD_RATIOS[2]  # 23.976 film played at 25 fps: the target runs fast


def _check(jumps=(), ratio=1.0, offset=0.0, duration=2400.0, ref_cues=None):
    """Detect, correct, and compare every corrected line to where it belongs."""
    ref_cues = ref_cues or dialogue_cues(duration)
    target = edited(translated(ref_cues, offset), list(jumps), ratio)
    detection = detect_segments(SubtitleDocument(SRT, ref_cues), SubtitleDocument(SRT, target))
    corrected = retime(SubtitleDocument(SRT, target), detection.segments)

    truth = {c.text: c.start for c in ref_cues}
    # No real line is ever lost (only lines of a scene the video lacks).
    assert {c.text for c in target} - {c.text for c in corrected.cues} <= {"extra"}
    errors = np.array([c.start - truth[c.text] for c in corrected.cues if c.text in truth])
    # translated() jitters every edge by up to 0.2 s: that much is the
    # dub's own timing, not a sync error.
    assert abs(np.median(errors)) < 0.03
    assert np.mean(np.abs(errors) > 0.25) < 0.01
    return detection


def test_constant_offset_is_one_segment():
    detection = _check(offset=-3.4)
    assert len(detection.segments) == 1
    assert detection.ratio == 1.0


@pytest.mark.parametrize(
    "jumps",
    [
        [(600.0, 0.5)],  # a few frames more in an ad break
        [(600.0, -0.5)],
        [(500.0, 45.0)],  # a whole scene only the target has
        [(500.0, -45.0)],  # a scene missing from the target
        [(400.0, -1.0), (900.0, 0.6), (1500.0, 0.3), (2000.0, -20.0)],
    ],
)
def test_jumps_are_found_and_corrected(jumps):
    detection = _check(jumps=jumps)
    assert len(detection.segments) == len(jumps) + 1


@pytest.mark.parametrize("ratio", [PAL, 1 / PAL, STANDARD_RATIOS[3]])
def test_frame_rate_drift_is_found_and_corrected(ratio):
    detection = _check(ratio=ratio, offset=1.2)
    assert detection.ratio == pytest.approx(ratio)


def test_drift_and_jumps_together():
    detection = _check(jumps=[(700.0, -0.8), (1600.0, 30.0)], ratio=PAL)
    assert detection.ratio == pytest.approx(PAL)
    assert len(detection.segments) == 3


def test_scene_only_in_the_target_has_its_lines_dropped():
    ref_cues = dialogue_cues(1800.0)
    target = edited(translated(ref_cues), [(600.0, 60.0)])
    detection = detect_segments(SubtitleDocument(SRT, ref_cues), SubtitleDocument(SRT, target))
    corrected = retime(SubtitleDocument(SRT, target), detection.segments)
    extra = sum(c.text == "extra" for c in target)
    assert extra > 10
    assert sum(c.text == "extra" for c in corrected.cues) <= 1


def test_a_teaser_before_credits_the_target_lacks_is_its_own_segment():
    # Seen on a real episode: a 45 s teaser, then a minute of opening
    # credits (no dialogue) the target's version doesn't have, at PAL speed.
    # Its stretch is shorter than the long windows: they all see the rest.
    ref_cues = [c for c in dialogue_cues(2400.0) if c.end < 45.0 or c.start >= 105.0]
    detection = _check(jumps=[(46.0, -55.0)], ratio=PAL, ref_cues=ref_cues)
    assert len(detection.segments) == 2


@pytest.mark.parametrize("seed", [2, 8, 10, 11])
def test_a_previously_only_the_target_has_is_dropped_not_put_on_the_first_scene(seed):
    """Seen on real episodes: the target opens on 45 s of "previously"
    (lines of other episodes, packed), then the episode itself 52 s later
    than the video. It used to land by chance on the first scene, whose
    own lines were then dropped."""
    rng = np.random.default_rng(seed + 100)
    recap, t = [], 1.0
    while t < 45.0:
        length = rng.uniform(1.0, 3.0)
        recap.append(Cue(t, t + length, "extra"))
        t += length + rng.uniform(0.1, 0.6)
    ref_cues = dialogue_cues(1800.0, seed=seed)
    target = recap + translated(ref_cues, 52.0)
    detection = detect_segments(SubtitleDocument(SRT, ref_cues), SubtitleDocument(SRT, target))
    corrected = retime(SubtitleDocument(SRT, target), detection.segments)
    assert {c.text for c in target} - {c.text for c in corrected.cues} <= {"extra"}
    assert not any(c.text == "extra" for c in corrected.cues)


def test_names_are_capitalized_words_not_starting_a_sentence():
    from syncsubtitles.segments import _names

    assert _names("Bah, Joe Namath portera des bas. Toujours") == {"joe", "namath"}
    assert _names("- Lane?\n- C'est moi, Rory") == {"rory"}
    assert _names("C'était quand on a eu la Jeep") == {"jeep"}
    # An all-caps line: every word may be one.
    assert _names("ÉTÉ À CHILTON") == {"ete", "chilton"}


def test_a_line_straddling_a_small_jump_joins_a_neighbour_a_scene_does_not():
    """At an ad break one edit has a second more of black: a dub line
    merging the reference's two lines each side of it straddles the jump,
    left out by the Viterbi; it's a real line. Lines of a 30 s scene only
    the target has are not."""
    from syncsubtitles.activity import FRAME_RATE, activity_signal
    from syncsubtitles.segments import _cue_frames, _reference, _with_jump_orphans

    ref = [Cue(10.0 + 3 * i, 12.0 + 3 * i, f"line {i}") for i in range(8)]
    reference = _reference(ref, activity_signal(ref, 200.0))
    jump = int(1.0 * FRAME_RATE)
    # Lines 0-2 as the reference's, then one merging 3 and 4, then 5-7 a second later.
    target = [*ref[:3], Cue(19.0, 24.5 + 1.0, "merged"), *(Cue(c.start + 1.0, c.end + 1.0, c.text) for c in ref[5:])]
    frames = _cue_frames(target)
    kept = np.array([True, True, True, False, True, True, True])
    groups = [(np.array([0, 1, 2]), 0), (np.array([4, 5, 6]), jump)]
    out = _with_jump_orphans(groups, kept, reference, ref, target, frames)
    assert kept.all()
    assert sorted(np.concatenate([m for m, _ in out]).tolist()) == list(range(7))

    # A 30 s scene only the target has: its lines land on the next ones' stretch.
    scene = [Cue(19.0 + 3 * i, 21.0 + 3 * i, "extra") for i in range(10)]
    target = [*ref[:3], *scene, *(Cue(c.start + 30.0, c.end + 30.0, c.text) for c in ref[3:])]
    frames = _cue_frames(target)
    kept = np.array([True] * 3 + [False] * 10 + [True] * 5)
    groups = [(np.array([0, 1, 2]), 0), (np.arange(13, 18), int(30.0 * FRAME_RATE))]
    _with_jump_orphans(groups, kept, reference, ref, target, frames)
    assert not kept[3:13].any()
