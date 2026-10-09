import os
import dotenv
from typing import List, Optional
from huggingface_hub import InferenceClient

dotenv.load_dotenv()

# ---------------------------------------------------------------------------
# Single model used for ALL embeddings — both remote API and local fallback.
# Keeping one model ensures the entire embedding space stays consistent:
# vectors stored via API and vectors stored via local fallback are comparable.
#
# Model : sentence-transformers/all-MiniLM-L6-v2  (384-dim, ~90 MB)
# Remote: HuggingFace Inference API (free tier / PRO)
# Local : sentence-transformers library  →  pip install sentence-transformers==3.4.1
# ---------------------------------------------------------------------------
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

_local_model = None  # lazy-loaded on first use


def _get_local_model():
    """Lazy-load the local sentence-transformer model (cached after first call)."""
    global _local_model
    if _local_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            print(f"[i] Loading local embedding model ({EMBEDDING_MODEL})...")
            _local_model = SentenceTransformer(EMBEDDING_MODEL)
            print("[+] Local embedding model loaded.")
        except ImportError:
            raise RuntimeError(
                "sentence-transformers is not installed. "
                "Run: pip install sentence-transformers==3.4.1"
            )
    return _local_model


def _pad_or_truncate(vec: List[float], target_dim: int) -> List[float]:
    """Expand or shrink a vector to exactly target_dim."""
    if len(vec) < target_dim:
        factor = (target_dim // len(vec)) + 1
        vec = (vec * factor)[:target_dim]
    elif len(vec) > target_dim:
        vec = vec[:target_dim]
    return vec


def _generate_local_embedding(text: str, target_dim: int = 1536) -> List[float]:
    """Generate embedding locally using the shared EMBEDDING_MODEL."""
    model = _get_local_model()
    vec = model.encode(text, normalize_embeddings=True).tolist()
    return _pad_or_truncate(vec, target_dim)


def get_huggingface_client() -> InferenceClient:
    token = os.getenv("HUGGING_KEY") or os.getenv("HF_TOKEN")
    return InferenceClient(token=token)


def generate_embedding(text: str, target_dim: int = 1536) -> Optional[List[float]]:
    """
    Generates a text embedding at target_dim (default 1536) to match Postgres vector(1536).

    Both paths use the same model (EMBEDDING_MODEL = all-MiniLM-L6-v2) so every
    vector in the database lives in the same embedding space regardless of which
    path produced it.

    Strategy:
      1. Try the HuggingFace Inference API (fast, no local RAM cost).
      2. On any API failure (402 quota exhausted, network error, etc.) fall back
         to running the model locally via sentence-transformers.
      3. If the local model also fails, return None so callers can skip vector
         DB operations gracefully rather than crashing.
    """
    # ── 1. Try remote API ──────────────────────────────────────────────────
    try:
        client = get_huggingface_client()
        emb = client.feature_extraction(text=text, model=EMBEDDING_MODEL)

        if hasattr(emb, "tolist"):
            emb = emb.tolist()
        if isinstance(emb, list) and len(emb) > 0 and isinstance(emb[0], list):
            emb = emb[0]

        return _pad_or_truncate([float(x) for x in emb], target_dim)

    except Exception as api_err:
        print(f"[-] HuggingFace API embedding failed: {api_err}")
        print(f"[i] Falling back to local {EMBEDDING_MODEL}...")

    # ── 2. Local fallback (same model, same embedding space) ───────────────
    try:
        return _generate_local_embedding(text, target_dim)
    except Exception as local_err:
        print(f"[-] Local embedding model also failed: {local_err}")
        # Callers check for None and skip vector DB operations gracefully.
        return None
