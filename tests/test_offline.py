from backend import config


def test_incomplete_model_cannot_trigger_tokenizer_download(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "MODEL", tmp_path)
    (tmp_path / "model.bin").write_bytes(b"weights")
    assert not config.model_ready()
    for name in ["config.json", "tokenizer.json", "vocabulary.txt"]:
        (tmp_path / name).write_text("{}")
    assert config.model_ready()


def test_api_docs_have_no_remote_scripts():
    from backend.main import offline_api_docs

    doc = offline_api_docs()
    assert "<script" not in doc
    assert "https://" not in doc
    assert "/openapi.json" in doc
