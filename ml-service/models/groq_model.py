import os
from typing import Optional
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

class GroqModel:
    """
    Simple text-generation wrapper around the Groq SDK.
    Mirrors the GeminiModel.run() interface so callers are interchangeable.
    """

    DEFAULT_MODEL = "qwen/qwen3.8-27b"

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or os.getenv("GROQ_API_KEY")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY is not set.")
        self.model = model or os.getenv("GROQ_TEXT_MODEL") or self.DEFAULT_MODEL
        self.client = Groq(api_key=self.api_key)

    def run(self, prompt: str) -> str:
        """Send a prompt and return the text response. Raises on error."""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            raise RuntimeError(f"Error calling Groq model: {e}") from e
