"""The eval orchestrator must pass Phase-2 multi-hop sampling options through
to run_doc_pipeline — without them every orchestrated run silently produces
0 multi-hop chains (found on the 2026-07-10 resnet_arxiv run: n_multihop=0).
"""

from rag_gt.allpdf import eval_orchestrator as eo


def test_run_and_evaluate_passes_multihop_options_to_pipeline(monkeypatch, tmp_path):
    captured = {}

    def _fake_pipeline(doc_id, pdf_path, out_dir, **kwargs):
        captured.update(kwargs, doc_id=doc_id)
        return {"doc_id": doc_id, "pipeline_passed": True, "n_pairs": 0}

    monkeypatch.setattr(eo, "run_doc_pipeline", _fake_pipeline)

    eo.run_and_evaluate(
        "docx", "docx.pdf", str(tmp_path),
        dry_run=True,
        multihop_chains=24,
        multihop_depths=(2, 3),
        cross_page_bias=2.0,
        min_page_gap=1,
        score_necessity=True,
    )

    assert captured["doc_id"] == "docx"
    assert captured["multihop_chains"] == 24
    assert captured["multihop_depths"] == (2, 3)
    assert captured["cross_page_bias"] == 2.0
    assert captured["min_page_gap"] == 1
    assert captured["score_necessity"] is True
