"""
huggingface_embeddings.py
--------------------------
Generates text embeddings using a single model for both the remote API path
and the local fallback path, keeping the entire embedding space consistent.

Model  : sentence-transformers/all-MiniLM-L6-v2  (384-dim → padded to 1536)
Remote : HuggingFace Inference API  (free tier / PRO credits)
Local  : fastembed — ONNX Runtime CPU inference, no torch, no CUDA (~50 MB)
         Install: pip install fastembed==0.6.1

HuggingFace quota caching
--------------------------
When the HF Inference API returns 402 (no credits), the exhausted state is
written to Redis with a 24-hour TTL.  Subsequent calls skip the remote API
entirely and go straight to fastembed, eliminating the per-call 402 round-trip.
The key is cleared automatically when the TTL expires.
"""
import os
import json
import time
import dotenv
from typing import List, Optional
from huggingface_hub import InferenceClient

dotenv.load_dotenv()

# ---------------------------------------------------------------------------
# Model config
# ---------------------------------------------------------------------------
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
_FASTEMBED_MODEL = "BAAI/bge-small-en-v1.5"

# Redis key that records HF API quota exhaustion
_HF_QUOTA_REDIS_KEY = "api_quota:huggingface"
_HF_QUOTA_TTL_SECONDS = 24 * 60 * 60  # 24 hours

_local_model = None  # lazy-loaded on first use


# ---------------------------------------------------------------------------
# Redis helpers (thin wrappers — avoids importing all of utils.llm)
# ---------------------------------------------------------------------------

def _get_redis():
    try:
        import redis as _redis
        url = os.getenv("REDIS_URL") or os.getenv("UPSTASH_REDIS_URL")
        if url:
            return _redis.Redis.from_url(url, decode_responses=True)
        return _redis.Redis(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            password=os.getenv("REDIS_PASSWORD") or None,
            decode_responses=True,
        )
    except Exception:
        return None


def _is_hf_quota_exhausted() -> bool:
    """Return True if the HF API is known to be quota-exhausted (cached in Redis)."""
    try:
        r = _get_redis()
        if not r:
            return False
        data = r.get(_HF_QUOTA_REDIS_KEY)
        if not data:
            return False
        info = json.loads(data)
        reset_at = info.get("resetAt", 0)
        if time.time() * 1000 >= reset_at:
            # TTL has passed — clear the key and treat as available
            r.delete(_HF_QUOTA_REDIS_KEY)
            return False
        return info.get("status") == "EXHAUSTED"
    except Exception:
        return False  # on any Redis error, attempt the API


def _mark_hf_quota_exhausted() -> None:
    """Cache HF quota-exhausted state in Redis for 24 hours."""
    try:
        r = _get_redis()
        if not r:
            return
        reset_at_ms = int((time.time() + _HF_QUOTA_TTL_SECONDS) * 1000)
        payload = {
            "status": "EXHAUSTED",
            "resetAt": reset_at_ms,
            "message": "HuggingFace Inference API credits exhausted (402). Using local fastembed.",
        }
        r.set(_HF_QUOTA_REDIS_KEY, json.dumps(payload), ex=_HF_QUOTA_TTL_SECONDS + 300)
        print(f"[HFEmbeddings] Marked HuggingFace API as exhausted in Redis for 24h.")
    except Exception as e:
        print(f"[HFEmbeddings] Redis write warning: {e}")


# ---------------------------------------------------------------------------
# Local model
# ---------------------------------------------------------------------------

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
    embeddings = list(model.embed([text]))
    vec = embeddings[0].tolist()
    return _pad_or_truncate(vec, target_dim)


def get_huggingface_client() -> InferenceClient:
    token = os.getenv("HUGGING_KEY") or os.getenv("HF_TOKEN")
    return InferenceClient(token=token)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_embedding(text: str, target_dim: int = 1536) -> Optional[List[float]]:
    """
    Generates a text embedding at target_dim (default 1536) to match Postgres vector(1536).

    Both paths produce vectors in the same embedding space so every vector in
    the DB is comparable regardless of which path produced it.

    Strategy:
      1. Check Redis — if HF API is known-exhausted (cached 402), skip to step 2.
      2. Try HuggingFace Inference API. On 402, cache the exhaustion in Redis for
         24h so no further API calls are made until quota resets.
      3. Fall back to fastembed (ONNX Runtime, CPU-only, no torch/CUDA).
      4. If the local model also fails, return None so callers can skip vector
         DB operations gracefully rather than crashing.
    """
    # ── 1. Fast-path: skip API if known exhausted ─────────────────────────
    if _is_hf_quota_exhausted():
        return _generate_local_embedding_safe(text, target_dim)

    # ── 2. Try remote API ─────────────────────────────────────────────────
    try:
        client = get_huggingface_client()
        emb = client.feature_extraction(text=text, model=EMBEDDING_MODEL)

        if hasattr(emb, "tolist"):
            emb = emb.tolist()
        if isinstance(emb, list) and len(emb) > 0 and isinstance(emb[0], list):
            emb = emb[0]

        return _pad_or_truncate([float(x) for x in emb], target_dim)

    except Exception as api_err:
        err_str = str(api_err)
        is_quota = "402" in err_str or "payment required" in err_str.lower() or "no remaining credits" in err_str.lower()
        if is_quota:
            print(f"[-] HuggingFace API quota exhausted (402). Caching in Redis for 24h.")
            _mark_hf_quota_exhausted()
        else:
            print(f"[-] HuggingFace API embedding failed: {api_err}")
        print(f"[i] Falling back to local fastembed ({_FASTEMBED_MODEL})...")

    # ── 3. Local fallback ─────────────────────────────────────────────────
    return _generate_local_embedding_safe(text, target_dim)


def _generate_local_embedding_safe(text: str, target_dim: int = 1536) -> Optional[List[float]]:
    """Wraps local embedding with a safe None return on failure."""
    try:
        return _generate_local_embedding(text, target_dim)
    except Exception as local_err:
        print(f"[-] Local embedding model also failed: {local_err}")
        return None
