import os
import json
import time
import dotenv
import re
from typing import Optional, Dict, Any
import redis
from langchain_groq import ChatGroq

dotenv.load_dotenv()

DEFAULT_MODEL = os.getenv("GROQ_MODEL", "allam-2-7b")

class GroqQuotaExhaustedError(Exception):
    """Raised when Groq API rate limit or quota is exhausted."""
    def __init__(self, reset_at: float, message: str = "Groq API rate limit reached."):
        self.reset_at = reset_at # epoch timestamp in seconds
        self.message = message
        super().__init__(self.message)

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

def raise_groq_quota_from_error(err: Any) -> None:
    """Record Redis rate-limit status and raise GroqQuotaExhaustedError."""
    err_str = str(err)
    retry_sec = parse_groq_retry_after_seconds(err_str)
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
    Returns a ChatGroq LLM instance using the global model configuration (or specified model_name).
    """
    model = model_name or os.getenv("GROQ_MODEL") or DEFAULT_MODEL
    api_key = os.getenv("GROQ_API_KEY")
    return ChatGroq(
        model_name=model,
        api_key=api_key,
        temperature=temperature
    )

def invoke_groq_json(prompt: str, model_name: Optional[str] = None, temperature: float = 0.1, retries: int = 3) -> Optional[Dict[str, Any]]:
    """
    Invokes Groq LLM with automatic retries and parses JSON response.
    Respects Redis rate-limit status and raises GroqQuotaExhaustedError on 429 errors.
    """
    check_groq_availability()
    llm = get_groq_llm(model_name=model_name, temperature=temperature)
    
    for attempt in range(retries):
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
                raise_groq_quota_from_error(e)
            
            time.sleep(1.0)
    return None

