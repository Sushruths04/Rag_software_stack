import pytest

from rag_gt.core.llm import APIError, APILLM


class _RateLimitedResponse:
    status_code = 429
    headers = {"Retry-After": "30"}
    text = ""


def test_api_retry_controls_can_be_reduced_for_paid_probe(monkeypatch):
    monkeypatch.setenv("API_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("API_REQUEST_TIMEOUT_SECONDS", "11")
    monkeypatch.setenv("API_RETRY_SLEEP_CAP_SECONDS", "2")

    llm = APILLM("https://provider.example/v1", "secret", "model-name")

    assert llm.max_attempts == 1
    assert llm.request_timeout_seconds == 11.0
    assert llm.retry_sleep_cap_seconds == 2.0


def test_rate_limit_on_final_attempt_does_not_sleep(monkeypatch):
    monkeypatch.setenv("API_MAX_ATTEMPTS", "1")
    llm = APILLM("https://provider.example/v1", "secret", "model-name")
    monkeypatch.setattr(llm._session, "post", lambda *args, **kwargs: _RateLimitedResponse())
    sleep_calls = []
    monkeypatch.setattr(
        "rag_gt.core.llm._backoff_sleep",
        lambda *args, **kwargs: sleep_calls.append((args, kwargs)),
    )

    with pytest.raises(APIError, match="rate-limited"):
        llm.generate("test")

    assert sleep_calls == []


class _OkResponse:
    status_code = 200
    text = "ok"

    def __init__(self, content="hello", prompt_tokens=100, completion_tokens=50):
        self._body = {
            "choices": [{"message": {"content": content}}],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
        }

    def json(self):
        return self._body


def test_generate_accumulates_real_token_usage(monkeypatch):
    """Every successful call must record the server-reported token usage so a
    run can report its ACTUAL cost (tokens + wall time), not an estimate."""
    monkeypatch.setenv("API_MAX_ATTEMPTS", "1")
    llm = APILLM("https://provider.example/v1", "secret", "model-name")
    monkeypatch.setattr(
        llm._session, "post",
        lambda *a, **k: _OkResponse(prompt_tokens=120, completion_tokens=80),
    )

    llm.generate("q1")
    llm.generate("q2")

    u = llm.usage_summary()
    assert u["calls"] == 2
    assert u["prompt_tokens"] == 240
    assert u["completion_tokens"] == 160
    assert u["wall_sec"] >= 0.0
    assert "completion_tokens_per_sec" in u


def test_usage_summary_handles_missing_usage_field(monkeypatch):
    monkeypatch.setenv("API_MAX_ATTEMPTS", "1")
    llm = APILLM("https://provider.example/v1", "secret", "model-name")

    class _NoUsage(_OkResponse):
        def __init__(self):
            self._body = {"choices": [{"message": {"content": "hi"}}]}

    monkeypatch.setattr(llm._session, "post", lambda *a, **k: _NoUsage())
    llm.generate("q")
    u = llm.usage_summary()
    assert u["calls"] == 1
    assert u["prompt_tokens"] == 0
