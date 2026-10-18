from syncsubtitles.ffmpeg_backend import _child_env


def test_child_env_gives_ffmpeg_the_systems_libraries_back(monkeypatch):
    """A Linux PyInstaller build points LD_LIBRARY_PATH at its own bundle:
    the system's ffmpeg must not load the bundle's libstdc++."""
    monkeypatch.setattr("sys.platform", "linux")
    frozen = {"LD_LIBRARY_PATH": "/usr/lib/app/_internal", "LD_LIBRARY_PATH_ORIG": "/opt/lib", "HOME": "/home/u"}
    assert _child_env(frozen, frozen=True) == {"LD_LIBRARY_PATH": "/opt/lib", "HOME": "/home/u"}
    # None before launch: none for ffmpeg either.
    assert _child_env({"LD_LIBRARY_PATH": "/usr/lib/app/_internal", "HOME": "/home/u"}, frozen=True) == {
        "HOME": "/home/u"
    }
    # Not frozen (dev, tests): inherited as is.
    assert _child_env(frozen, frozen=False) is None


def test_child_env_leaves_windows_alone(monkeypatch):
    monkeypatch.setattr("sys.platform", "win32")
    assert _child_env({"PATH": "C:/ffmpeg"}, frozen=True) is None
