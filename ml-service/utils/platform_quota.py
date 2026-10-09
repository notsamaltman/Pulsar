"""
platform_quota.py
-----------------
Writes and reads platform API quota state (YouTube, ProductHunt) to/from Redis
so the frontend can block campaign creation when a platform's daily quota is gone.

Redis key schema:
  api_quota:<platform>  →  JSON string matching the PlatformQuota TS interface
"""
import json
import time
import os
from typing import Optional, Literal

PlatformName = Literal["youtube", "producthunt"]
StatusValue = Literal["AVAILABLE", "EXHAUSTED", "RATE_LIMITED"]

# YouTube Data API v3 quota resets daily at midnight Pacific (UTC-8 / UTC-7 DST).
# We default to 24 h from now as a safe upper bound.
_YOUTUBE_RESET_SECONDS = 24 * 60 * 60   # 24 h
_PRODUCTHUNT_RESET_SECONDS = 60 * 60     # 1 h (rate limits, not daily quota)


def _get_redis():
    from utils.llm import get_redis_client  # avoids circular import at module level
    return get_redis_client()


def _quota_key(platform: PlatformName) -> str:
    return f"api_quota:{platform}"


def set_platform_quota_exhausted(
    platform: PlatformName,
    message: str = "",
    reset_after_seconds: Optional[int] = None,
) -> None:
    """
    Mark a platform as quota-exhausted in Redis.
    The frontend service-health endpoint reads this and disables the platform checkbox.
    """
    if reset_after_seconds is None:
        reset_after_seconds = (
            _YOUTUBE_RESET_SECONDS if platform == "youtube" else _PRODUCTHUNT_RESET_SECONDS
        )

    reset_at_ms = int((time.time() + reset_after_seconds) * 1000)
    payload = {
        "platform": platform,
        "status": "EXHAUSTED",
        "resetAt": reset_at_ms,
        "message": message or f"{platform} daily API quota exhausted.",
        "available": False,
    }
    try:
        r = _get_redis()
        r.set(_quota_key(platform), json.dumps(payload), ex=reset_after_seconds + 300)
        print(
            f"[PlatformQuota] {platform} marked EXHAUSTED in Redis. "
            f"Resets in ~{reset_after_seconds // 60} min."
        )
    except Exception as e:
        print(f"[PlatformQuota] Warning — could not write to Redis: {e}")


def set_platform_quota_rate_limited(
    platform: PlatformName,
    message: str = "",
    retry_after_seconds: int = 600,
) -> None:
    """Mark a platform as temporarily rate-limited (shorter window than full exhaust)."""
    reset_at_ms = int((time.time() + retry_after_seconds) * 1000)
    payload = {
        "platform": platform,
        "status": "RATE_LIMITED",
        "resetAt": reset_at_ms,
        "message": message or f"{platform} is rate-limited.",
        "available": False,
    }
    try:
        r = _get_redis()
        r.set(_quota_key(platform), json.dumps(payload), ex=retry_after_seconds + 60)
        print(
            f"[PlatformQuota] {platform} marked RATE_LIMITED in Redis. "
            f"Resets in ~{retry_after_seconds}s."
        )
    except Exception as e:
        print(f"[PlatformQuota] Warning — could not write to Redis: {e}")


def clear_platform_quota(platform: PlatformName) -> None:
    """Mark a platform as available again (call when a new quota window opens)."""
    payload = {
        "platform": platform,
        "status": "AVAILABLE",
        "resetAt": None,
        "message": "",
        "available": True,
    }
    try:
        r = _get_redis()
        r.set(_quota_key(platform), json.dumps(payload), ex=86400)
        print(f"[PlatformQuota] {platform} marked AVAILABLE in Redis.")
    except Exception as e:
        print(f"[PlatformQuota] Warning — could not write to Redis: {e}")


def get_platform_quota_status(platform: PlatformName) -> dict:
    """Read current quota status from Redis. Returns available=True if key is missing."""
    try:
        r = _get_redis()
        data = r.get(_quota_key(platform))
        if not data:
            return {"platform": platform, "status": "AVAILABLE", "resetAt": None, "available": True}
        parsed = json.loads(data)
        # Auto-clear expired entries
        reset_at = parsed.get("resetAt")
        if reset_at and time.time() * 1000 >= reset_at:
            return {"platform": platform, "status": "AVAILABLE", "resetAt": None, "available": True}
        return parsed
    except Exception as e:
        print(f"[PlatformQuota] Warning — could not read from Redis: {e}")
        return {"platform": platform, "status": "AVAILABLE", "resetAt": None, "available": True}


def is_platform_available(platform: PlatformName) -> bool:
    return get_platform_quota_status(platform).get("available", True)
