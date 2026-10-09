import os
from typing import Optional
from dotenv import load_dotenv
from groq import Groq

load_dotenv()


class GroqModel:
    """
    Simple text-generation wrapper around the Groq SDK.
    Mirrors the GeminiModel.run() interface so callers are interchangeable.

    API key selection is delegated to the GroqKeyBalancer in utils.llm so
    all four keys (GROQ_API_KEY_1 … GROQ_API_KEY_4) are used round-robin
    and rate-limited keys are automatically skipped.
    """

    DEFAULT_MODEL = "qwen/qwen3.8-27b"

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        # If an explicit key is supplied (e.g. in tests) use it directly;
        # otherwise defer to the balancer on every run() call.
        self._explicit_key: Optional[str] = api_key
        self.model = model or os.getenv("GROQ_TEXT_MODEL") or os.getenv("GROQ_MODEL") or self.DEFAULT_MODEL

    def _get_client(self) -> Groq:
        """Return a Groq client using either the explicit key or the next balanced key."""
        if self._explicit_key:
            return Groq(api_key=self._explicit_key)

        from utils.llm import get_key_balancer
        api_key = get_key_balancer().get_key()
        return Groq(api_key=api_key)

    def run(self, prompt: str) -> str:
        """Send a prompt and return the text response.

        On a rate-limit error the offending key is marked in the balancer
        and a RuntimeError is raised.  Callers that wrap this in
        looks_like_groq_limit / raise_groq_quota_from_error will handle it
        correctly.
        """
        from utils.llm import get_key_balancer, looks_like_groq_limit

        client = self._get_client()
        # Track which key we used so we can mark it on failure
        used_key: Optional[str] = client.api_key  # type: ignore[attr-defined]

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            if looks_like_groq_limit(e) and not self._explicit_key and used_key:
                try:
                    get_key_balancer().mark_rate_limited(used_key)
                except Exception:
                    pass
            raise RuntimeError(f"Error calling Groq model: {e}") from e
