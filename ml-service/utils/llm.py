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
            
            # Intercept 429 / Rate limit errors
            if "429" in err_str or "rate limit" in err_str.lower() or "quota" in err_str.lower():
                # Try parsing retry-after from error string if present (e.g. "try again in 15m", "try again in 300s")
                match = re.search(r"try again in (\d+)([smh])", err_str.lower())
                retry_sec = 900 # default 15 mins
                if match:
                    val = int(match.group(1))
                    unit = match.group(2)
                    if unit == 's': retry_sec = val
                    elif unit == 'm': retry_sec = val * 60
                    elif unit == 'h': retry_sec = val * 3600
                
                set_groq_rate_limited(retry_after_seconds=retry_sec, message=f"Groq API rate limit reached: {err_str}")
                raise GroqQuotaExhaustedError(
                    reset_at=time.time() + retry_sec,
                    message=f"Groq API rate limit reached. Resets in ~{retry_sec//60} mins."
                )
            
            time.sleep(1.0)
    return None

