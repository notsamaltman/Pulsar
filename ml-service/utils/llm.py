import os
import json
import time
import dotenv
import re
import threading
from typing import Optional, Dict, Any, List
import redis
from langchain_groq import ChatGroq

dotenv.load_dotenv()

DEFAULT_MODEL = os.getenv("GROQ_MODEL", "allam-2-7b")


# ---------------------------------------------------------------------------
# Exception (defined first — used by the key balancer below)
# ---------------------------------------------------------------------------

class GroqQuotaExhaustedError(Exception):
    """Raised when Groq API rate limit or quota is exhausted."""
    def __init__(self, reset_at: float, message: str = "Groq API rate limit reached."):
        self.reset_at = reset_at  # epoch timestamp in seconds
        self.message = message
        super().__init__(self.message)


# ---------------------------------------------------------------------------
# Key Load Balancer
# ---------------------------------------------------------------------------

class GroqKeyBalancer:
    """
    Round-robin load balancer across up to 4 Groq API keys.

    Keys are read from env at first use:
      GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3, GROQ_API_KEY_4

    Falls back to GROQ_API_KEY if none of the numbered keys are set.

    Per-key rate-limit state is tracked in memory (thread-safe) and also
    mirrored in Redis using keys of the form  groq:key_status:<index>.
    When a key hits a 429 it is marked unavailable until its reset window
    elapses, and the balancer automatically skips it.
    """

    _instance: Optional["GroqKeyBalancer"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "GroqKeyBalancer":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        self._keys: List[str] = self._load_keys()
        self._index: int = 0           # next key to try (round-robin cursor)
        self._rate_limited_until: List[float] = [0.0] * len(self._keys)
        self._iter_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Key discovery
    # ------------------------------------------------------------------

    @staticmethod
    def _load_keys() -> List[str]:
        """Collect numbered keys from env; fall back to bare GROQ_API_KEY."""
        keys: List[str] = []
        for i in range(1, 5):
            key = os.getenv(f"GROQ_API_KEY_{i}", "").strip()
            if key:
                keys.append(key)
        if not keys:
            fallback = os.getenv("GROQ_API_KEY", "").strip()
            if fallback:
                keys.append(fallback)
        if not keys:
            raise ValueError(
                "No Groq API keys found. Set GROQ_API_KEY_1 … GROQ_API_KEY_4 "
                "(or GROQ_API_KEY) in your environment."
            )
        print(f"[GroqKeyBalancer] Loaded {len(keys)} API key(s).")
        return keys

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_key(self) -> str:
        """
        Return the next available API key using round-robin, skipping any
        that are currently rate-limited.  Raises GroqQuotaExhaustedError
        when *all* keys are exhausted.
        """
        with self._iter_lock:
            now = time.time()
            # Find the earliest reset time across all blocked keys
            earliest_reset: Optional[float] = None

            for attempt in range(len(self._keys)):
                idx = self._index % len(self._keys)
                self._index += 1
                blocked_until = self._rate_limited_until[idx]
                if blocked_until <= now:
                    key = self._keys[idx]
                    print(f"[GroqKeyBalancer] Using key index {idx + 1}/{len(self._keys)}")
                    return key
                # Track earliest reset
                if earliest_reset is None or blocked_until < earliest_reset:
                    earliest_reset = blocked_until

            # All keys are currently rate-limited
            reset_at = earliest_reset or (now + 900)
            raise GroqQuotaExhaustedError(
                reset_at=reset_at,
                message=(
                    f"All {len(self._keys)} Groq API keys are rate-limited. "
                    f"Earliest reset in ~{int(reset_at - now)}s."
                ),
            )

    def mark_rate_limited(self, key: str, retry_after_seconds: int = 900) -> None:
        """Mark a specific key as rate-limited for *retry_after_seconds* seconds."""
        try:
            idx = self._keys.index(key)
        except ValueError:
            return
        reset_at = time.time() + retry_after_seconds
        self._rate_limited_until[idx] = reset_at
        print(
            f"[GroqKeyBalancer] Key index {idx + 1}/{len(self._keys)} rate-limited for "
            f"~{retry_after_seconds}s (resets at {int(reset_at)})."
        )
        # Also persist to Redis so other workers see it
        try:
            r = get_redis_client()
            info = {
                "status": "TEMPORARILY_RATE_LIMITED",
                "resetAt": int(reset_at * 1000),
                "message": f"Key {idx + 1} rate-limited.",
            }
            r.set(f"groq:key_status:{idx}", json.dumps(info), ex=retry_after_seconds + 60)
        except Exception as e:
            print(f"[GroqKeyBalancer] Redis persist warning: {e}")

    def sync_from_redis(self) -> None:
        """Pull per-key rate-limit state from Redis into memory (call at startup)."""
        try:
            r = get_redis_client()
            now_ms = time.time() * 1000
            for idx in range(len(self._keys)):
                data = r.get(f"groq:key_status:{idx}")
                if not data:
                    continue
                info = json.loads(data)
                reset_at_ms = info.get("resetAt", 0)
                if info.get("status") == "TEMPORARILY_RATE_LIMITED" and reset_at_ms > now_ms:
                    self._rate_limited_until[idx] = reset_at_ms / 1000.0
        except Exception as e:
            print(f"[GroqKeyBalancer] Redis sync warning: {e}")

    @property
    def key_count(self) -> int:
        return len(self._keys)


# Module-level singleton — import and use directly
_key_balancer: Optional[GroqKeyBalancer] = None


def get_key_balancer() -> GroqKeyBalancer:
    global _key_balancer
    if _key_balancer is None:
        _key_balancer = GroqKeyBalancer()
    return _key_balancer

def looks_like_groq_limit(err: Any) -> bool:
    """True when an exception or message indicates Groq 429 / quota exhaustion."""
    if isinstance(err, GroqQuotaExhaustedError):
        return True
    err_str = str(err).lower() if err is not None else ""
    if not err_str:
        return False
    # YouTube Data API quota errors are not Groq
    if "quotaexceeded" in err_str.replace(" ", "") and "groq" not in err_str:
        return False
    if "429" in err_str or "rate limit" in err_str:
        return True
    if "quota" in err_str and "groq" in err_str:
        return True
    return "groq" in err_str and ("limit" in err_str or "exhausted" in err_str)

def parse_groq_retry_after_seconds(err_str: str, default: int = 900) -> int:
    """Parse 'try again in 15m' style hints from Groq error strings."""
    match = re.search(r"try again in (\d+)([smh])", (err_str or "").lower())
    if not match:
        return default
    val = int(match.group(1))
    unit = match.group(2)
    if unit == "s":
        return val
    if unit == "m":
        return val * 60
    if unit == "h":
        return val * 3600
    return default

def raise_groq_quota_from_error(err: Any, failed_key: Optional[str] = None) -> None:
    """Record rate-limit status for the offending key and raise GroqQuotaExhaustedError.

    If *failed_key* is supplied the balancer marks that specific key as
    rate-limited.  Either way the global Redis status block is also set so
    that older call-sites that don't pass a key still see the signal.
    """
    err_str = str(err)
    retry_sec = parse_groq_retry_after_seconds(err_str)
    # Mark the specific key in the balancer (best-effort)
    if failed_key:
        try:
            get_key_balancer().mark_rate_limited(failed_key, retry_after_seconds=retry_sec)
        except Exception:
            pass
    # Also set the legacy global Redis block for backward-compat
    set_groq_rate_limited(retry_after_seconds=retry_sec, message=f"Groq API rate limit reached: {err_str}")
    raise GroqQuotaExhaustedError(
        reset_at=time.time() + retry_sec,
        message=f"Groq API rate limit reached. Resets in ~{retry_sec // 60} mins."
    )

def get_redis_client():
    url = os.getenv("REDIS_URL") or os.getenv("UPSTASH_REDIS_URL")
    if url:
        return redis.Redis.from_url(url, decode_responses=True)
    host = os.getenv("REDIS_HOST", "localhost")
    port = int(os.getenv("REDIS_PORT", "6379"))
    password = os.getenv("REDIS_PASSWORD") or None
    return redis.Redis(host=host, port=port, password=password, decode_responses=True)

def check_groq_availability():
    """Checks Redis for active Groq rate-limit blocks. Throws GroqQuotaExhaustedError if currently blocked."""
    try:
        r = get_redis_client()
        data = r.get("groq:status_info")
        if data:
            info = json.loads(data)
            reset_at_ms = info.get("resetAt")
            if info.get("status") == "TEMPORARILY_RATE_LIMITED" and reset_at_ms:
                now_ms = time.time() * 1000
                if now_ms < reset_at_ms:
                    reset_sec = reset_at_ms / 1000.0
                    raise GroqQuotaExhaustedError(
                        reset_at=reset_sec,
                        message=info.get("message", "Groq rate limit currently active.")
                    )
    except GroqQuotaExhaustedError:
        raise
    except Exception as e:
        print(f"[!] Error checking Groq availability in Redis: {e}")

def set_groq_rate_limited(retry_after_seconds: int = 900, message: str = "Groq API rate limit reached."):
    """Sets Groq status in Redis so workers avoid making failing calls."""
    try:
        r = get_redis_client()
        reset_at_ms = int((time.time() + retry_after_seconds) * 1000)
        info = {
            "status": "TEMPORARILY_RATE_LIMITED",
            "resetAt": reset_at_ms,
            "message": message
        }
        r.set("groq:status_info", json.dumps(info))
        print(f"[!] Set Groq rate-limit status in Redis. Resets at {reset_at_ms} ms (~{retry_after_seconds}s from now).")
    except Exception as e:
        print(f"[!] Error setting Groq status in Redis: {e}")

def clear_groq_status_if_reset() -> bool:
    """Idle check: clear Redis Groq block once resetAt has passed.

    Returns True if Groq is still rate-limited (system should stay idle).
    """
    try:
        r = get_redis_client()
        data = r.get("groq:status_info")
        if not data:
            return False
        info = json.loads(data)
        status = info.get("status")
        if status not in ("TEMPORARILY_RATE_LIMITED", "DAILY_QUOTA_EXHAUSTED", "UNAVAILABLE"):
            return False
        reset_at_ms = info.get("resetAt")
        now_ms = time.time() * 1000
        if reset_at_ms and now_ms < reset_at_ms:
            remaining = int((reset_at_ms - now_ms) / 1000)
            print(f"[groq-idle] Groq still limited. Idle check in ~{remaining}s.")
            return True
        available = {"status": "AVAILABLE", "resetAt": None, "message": "Groq idle check passed — API available."}
        r.set("groq:status_info", json.dumps(available))
        print("[groq-idle] Groq window elapsed. Marked AVAILABLE.")
        return False
    except Exception as e:
        print(f"[!] Error during Groq idle check: {e}")
        return False

def get_groq_llm(model_name: Optional[str] = None, temperature: float = 0.1) -> ChatGroq:
    """
    Returns a ChatGroq LLM instance.

    The API key is selected via the GroqKeyBalancer (round-robin across
    GROQ_API_KEY_1 … GROQ_API_KEY_4, skipping any currently rate-limited).
    Raises GroqQuotaExhaustedError when all keys are exhausted.
    """
    model = model_name or os.getenv("GROQ_MODEL") or DEFAULT_MODEL
    api_key = get_key_balancer().get_key()
    return ChatGroq(
        model_name=model,
        api_key=api_key,
        temperature=temperature
    )

def invoke_groq_json(prompt: str, model_name: Optional[str] = None, temperature: float = 0.1, retries: int = 3) -> Optional[Dict[str, Any]]:
    """
    Invokes Groq LLM with automatic retries and parses JSON response.
    Respects Redis rate-limit status and raises GroqQuotaExhaustedError on 429 errors.
    Each attempt picks the next available key from the balancer so a rate-limited
    key is automatically skipped on subsequent attempts.
    """
    check_groq_availability()
    model = model_name or os.getenv("GROQ_MODEL") or DEFAULT_MODEL

    for attempt in range(retries):
        # Resolve key per-attempt so rate-limited keys get skipped automatically
        api_key = get_key_balancer().get_key()
        llm = ChatGroq(model_name=model, api_key=api_key, temperature=temperature)
        try:
            res = llm.invoke(prompt)
            content = res.content if hasattr(res, "content") else str(res)
            # Find JSON boundaries
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                json_str = content[start:end+1]
                return json.loads(json_str)
        except GroqQuotaExhaustedError:
            raise
        except Exception as e:
            err_str = str(e)
            print(f"[-] Groq LLM JSON attempt {attempt+1}/{retries} failed: {err_str}")

            if looks_like_groq_limit(e):
                raise_groq_quota_from_error(e, failed_key=api_key)

            time.sleep(1.0)
    return None

