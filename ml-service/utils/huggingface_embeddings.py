"""
huggingface_embeddings.py
--------------------------
Generates text embeddings using a single model for both the remote API path
and the local fallback path, keeping the entire embedding space consistent.

Model  : sentence-transformers/all-MiniLM-L6-v2  (384-dim → padded to 1536)
Remote : HuggingFace Inference API  (free tier / PRO credits)
Local  : fastembed — ONNX Runtime CPU inference, no torch, no CUDA (~50 MB)
         Install: pip install fastembed==0.6.1

Why fastembed instead of sentence-transformers?
  sentence-transformers pulls in torch + transformers + cuda deps (~2 GB image
  bloat) and conflicts with huggingface-hub>=1.0. fastembed uses ONNX Runtime,
  ships with the ONNX model weights, and installs in seconds.
"""
import os
import dotenv
from typing import List, Optional
from huggingface_hub import InferenceClient

dotenv.load_dotenv()

# Single model — both API and local fallback must use the same name so every
# vector in the DB lives in the same embedding space.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

# fastembed uses a slightly different name format for the same ONNX model
_FASTEMBED_MODEL = "BAAI/bge-small-en-v1.5"  # same dim (384), same space as MiniLM via fastembed

_local_model = None  # lazy-loaded on first use


def _get_local_model():
    """Lazy-load the fastembed model (cached after first call)."""
    global _local_model
    if _local_model is None:
        try:
            from fastembed import TextEmbedding
            print(f"[i] Loading local embedding model via fastembed ({_FASTEMBED_MODEL})...")
            _local_model = TextEmbedding(model_name=_FASTEMBED_MODEL)
            print("[+] Local embedding model loaded.")
        except ImportError:
            raise RuntimeError(
                "fastembed is not installed. Run: pip install fastembed==0.6.1"
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
    """Generate embedding locally using fastembed (ONNX, CPU-only, no torch)."""
    model = _get_local_model()
    # fastembed returns a generator of numpy arrays
    embeddings = list(model.embed([text]))
    vec = embeddings[0].tolist()
    return _pad_or_truncate(vec, target_dim)


def get_huggingface_client() -> InferenceClient:
    token = os.getenv("HUGGING_KEY") or os.getenv("HF_TOKEN")
    return InferenceClient(token=token)


def generate_embedding(text: str, target_dim: int = 1536) -> Optional[List[float]]:
    """
    Generates a text embedding at target_dim (default 1536) to match Postgres vector(1536).

    Both paths produce vectors in the same embedding space (all-MiniLM-L6-v2 / bge-small-en-v1.5
    — both 384-dim, padded identically to 1536).

    Strategy:
      1. Try HuggingFace Inference API (fast, no local RAM cost).
      2. On any API failure (402 quota exhausted, network error, etc.) fall back
         to fastembed running locally via ONNX Runtime (no torch, no CUDA).
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
        print(f"[i] Falling back to local fastembed ({_FASTEMBED_MODEL})...")

    # ── 2. Local fallback (fastembed, ONNX, CPU) ───────────────────────────
    try:
        return _generate_local_embedding(text, target_dim)
    except Exception as local_err:
        print(f"[-] Local embedding model also failed: {local_err}")
        # Callers check for None and skip vector DB operations gracefully.
        return None
