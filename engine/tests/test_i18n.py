"""Every message passed through i18n.tr has its English translation, with
the same fields; the GUI sets the language through POST /language. From
Bobine Audio."""

import ast
import string
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from syncsubtitles import i18n
from syncsubtitles.i18n import set_language, tr
from syncsubtitles.server import app

PACKAGE = Path(i18n.__file__).parent


def _templates() -> Iterator[tuple[str, str]]:
    for path in PACKAGE.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "tr":
                first = node.args[0]
                assert isinstance(first, ast.Constant) and isinstance(first.value, str), (
                    f"{path.name}: tr() needs a literal"
                )
                yield path.name, first.value


def _fields(template: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(template) if name}


@pytest.fixture(autouse=True)
def _back_to_french() -> Iterator[None]:
    yield
    set_language("fr")


def test_every_message_has_its_english_translation_with_the_same_fields() -> None:
    templates = list(_templates())
    assert len(templates) > 20
    for module, template in templates:
        assert template in i18n._EN, f"{module}: no English for {template!r}"
        assert _fields(i18n._EN[template]) == _fields(template), f"{module}: fields differ for {template!r}"


def test_no_translation_is_left_unused() -> None:
    used = {template for _, template in _templates()}
    assert set(i18n._EN) <= used


def test_messages_follow_the_language() -> None:
    assert tr("Fichier introuvable : {path}", path="a.mkv") == "Fichier introuvable : a.mkv"
    set_language("en")
    assert tr("Fichier introuvable : {path}", path="a.mkv") == "File not found: a.mkv"


def test_the_gui_sets_the_language() -> None:
    client = TestClient(app)
    assert client.post("/language", json={"language": "en"}).status_code == 204
    assert i18n.get_language() == "en"
    assert client.post("/jobs/nope/cancel").json() == {"detail": "Unknown job: nope"}
    assert client.post("/language", json={"language": "de"}).status_code == 400
    assert client.post("/language", json={"language": "fr"}).status_code == 204
    assert client.post("/jobs/nope/cancel").json() == {"detail": "Tâche inconnue : nope"}
