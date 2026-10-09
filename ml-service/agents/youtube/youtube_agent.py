import os
import sys
import re
import json
import time
import math
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Set, TypedDict
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# --- Add parent path to import utils ---
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from utils.lead_db import save_leads_to_supabase_sync, search_existing_leads_by_niche_sync

load_dotenv()

# Google API client for YouTube Data API v3
try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    build = None
    HttpError = Exception

from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END
from utils.llm import get_groq_llm, GroqQuotaExhaustedError, check_groq_availability, looks_like_groq_limit, raise_groq_quota_from_error
from utils.platform_quota import set_platform_quota_exhausted, set_platform_quota_rate_limited


# ==========================================
# 1. QUOTA MANAGER
# ==========================================
class YouTubeQuotaManager:
    """
    Tracks daily YouTube Data API v3 quota spend per agent execution.
    - search: 100 units  ← most expensive, minimise these
    - channels.list: 1 unit per request (up to 50 channels batch)
    - videos.list: 1 unit per request (up to 50 videos batch)
    - commentThreads.list: 1 unit per request

    Optimisation notes
    ------------------
    * Keep keyword searches to ≤ 3 per run (300 units total).
    * Batch channel detail fetches at 50 per call.
    * Use videos.list (1 unit per 50 videos) instead of search per channel.
    * Avoid get_recent_videos() for channels already in the DB.
    * When quota is gone, write EXHAUSTED state to Redis so the frontend
      can block new campaign jobs until the next day's quota window opens.
    """
    COSTS = {
        'search': 100,
        'channels.list': 1,
        'videos.list': 1,
        'commentThreads.list': 1,
    }

    def __init__(self, daily_budget: int = 5000):
        self.budget = daily_budget
        self.spent = 0
        self._exhausted = False   # set to True on a hard 403 quota error

    def can_afford(self, operation: str, count: int = 1) -> bool:
        if self._exhausted:
            return False
        cost = self.COSTS.get(operation, 1) * count
        return (self.spent + cost) <= self.budget

    def record_spend(self, operation: str, count: int = 1):
        cost = self.COSTS.get(operation, 1) * count
        self.spent += cost
        print(f"[QuotaManager] Operation '{operation}' (x{count}) cost {cost} units. Total spent: {self.spent}/{self.budget}")

    def mark_exhausted(self, message: str = ""):
        """Called on a hard 403 quota error — writes EXHAUSTED state to Redis (15-min reset)."""
        self._exhausted = True
        print(f"[QuotaManager] Daily YouTube quota exhausted. Writing state to Redis (15-min reset).")
        set_platform_quota_exhausted("youtube", message=message, reset_after_seconds=900)

    def mark_rate_limited(self, retry_after: int = 600):
        """Called on a transient 429 — 15-min Redis block matching quota reset window."""
        print(f"[QuotaManager] YouTube API rate-limited. Writing 15-min block to Redis.")
        set_platform_quota_rate_limited("youtube", retry_after_seconds=900)

    @property
    def is_exhausted(self) -> bool:
        return self._exhausted


# ==========================================
# 2. CONSTANTS & REGEX HELPERS
# ==========================================
SPONSORSHIP_SIGNALS = [
    'sponsored by', 'in partnership with', 'thanks to',
    'use code', 'discount code', 'affiliate link',
    'this video is sponsored', '#ad', '#sponsored',
    'coupon code', 'promotional link', 'partnered with'
]

INTENT_PATTERNS = [
    'looking for', 'any alternatives', 'switched from',
    'does this work for', 'how much does', 'pricing',
    'our company', 'we use', 'trying to find',
    'recommendation', 'best tool for', 'struggling with'
]

EMAIL_REGEX = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
URL_REGEX = r'https?://[^\s<>"]+|www\.[^\s<>"]+'


def extract_email(text: str) -> Optional[str]:
    """Extracts first valid email address from text snippet."""
    if not text:
        return None
    matches = re.findall(EMAIL_REGEX, text)
    # Ignore common false positives or image extensions
    valid_emails = [m for m in matches if not any(ext in m.lower() for ext in ['.png', '.jpg', '.jpeg', 'example.com', 'domain.com'])]
    return valid_emails[0] if valid_emails else None


def extract_website_links(text: str) -> List[str]:
    """Extracts external non-social links from text."""
    if not text:
        return []
    matches = re.findall(URL_REGEX, text)
    clean_links = []
    ignored_domains = ['youtube.com', 'youtu.be', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'tiktok.com']
    for link in matches:
        if not any(dom in link.lower() for dom in ignored_domains):
            clean_links.append(link.strip('/'))
    return clean_links


# ==========================================
# 3. YOUTUBE API DISCOVERY CORE
# ==========================================
class YouTubeAPIClient:
    def __init__(self, quota_manager: YouTubeQuotaManager, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("YOUTUBE_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not self.api_key:
            raise ValueError("Missing YOUTUBE_API_KEY or GOOGLE_API_KEY environment variable.")
        if build is None:
            raise ImportError("google-api-python-client is not installed. Please run pip install google-api-python-client.")
        
        self.youtube = build('youtube', 'v3', developerKey=self.api_key)
        self.quota = quota_manager

    def _execute_with_retry(self, request_obj, retries: int = 3, delay: float = 10.0):
        """
        Executes a YouTube API request with automatic retries.
        - 429 / transient 403 → sleep and retry (up to `retries` times)
        - Hard 403 quota exhaustion → mark quota, raise immediately (no retry)
        """
        for attempt in range(retries + 1):
            try:
                return request_obj.execute()
            except HttpError as e:
                status_code = int(getattr(e.resp, 'status', 0))
                err_str = str(e).lower()
                is_hard_quota = (
                    status_code == 403
                    and ("quotaexceeded" in err_str.replace(" ", "") or "dailylimitexceeded" in err_str)
                )
                is_rate_limit = status_code == 429 or (
                    status_code == 403 and not is_hard_quota and "rate" in err_str
                )

                if is_hard_quota:
                    self.quota.mark_exhausted(str(e))
                    raise e  # surface immediately, no retry

                if is_rate_limit and attempt < retries:
                    print(f"[YouTubeAPI] Rate limit hit ({e}). Sleeping {delay}s (Attempt {attempt+1}/{retries})...")
                    self.quota.mark_rate_limited(retry_after=int(delay * (attempt + 1)))
                    time.sleep(delay)
                else:
                    raise e
            except Exception as e:
                if ("429" in str(e) or "quota" in str(e).lower()) and attempt < retries:
                    print(f"[YouTubeAPI] Potential rate limit hit ({e}). Sleeping {delay}s (Attempt {attempt+1}/{retries})...")
                    time.sleep(delay)
                else:
                    raise e

    # --- Strategy 1: Keyword Search ---
    def search_channels(self, keyword: str, max_results: int = 50, geo_country: Optional[str] = None) -> List[str]:
        """Performs YouTube API channel search by keyword with 10s rate limit retries."""
        if not self.quota.can_afford('search'):
            print("[YouTubeAPI] Out of quota budget for search operation.")
            return []

        try:
            kwargs = {
                'q': keyword,
                'type': 'channel',
                'part': 'snippet',
                'maxResults': min(max_results, 50),
                'relevanceLanguage': 'en',
            }
            if geo_country and len(geo_country) == 2:
                kwargs['regionCode'] = geo_country.upper()

            req = self.youtube.search().list(**kwargs)
            response = self._execute_with_retry(req)
            self.quota.record_spend('search')

            channel_ids = [
                item['snippet']['channelId']
                for item in response.get('items', [])
                if 'snippet' in item and 'channelId' in item['snippet']
            ]
            print(f"[YouTubeAPI] Keyword search '{keyword}' found {len(channel_ids)} channels.")
            return channel_ids
        except HttpError as e:
            if self.quota.is_exhausted:
                print(f"[YouTubeAPI] Quota exhausted — skipping remaining searches.")
            else:
                print(f"[-] Error searching channels for keyword '{keyword}': {e}")
            return []
        except Exception as e:
            print(f"[-] Error searching channels for keyword '{keyword}': {e}")
            return []

    # --- Step 2: Batch Channel Details (up to 50 per request) ---
    def get_channel_details(self, channel_ids: List[str]) -> List[Dict[str, Any]]:
        """Batch fetches channel details (50 per call) with rate limit retries.
        Also captures the uploads playlist ID to avoid expensive search calls later."""
        if not channel_ids:
            return []

        results = []
        chunk_size = 50
        for i in range(0, len(channel_ids), chunk_size):
            if self.quota.is_exhausted:
                break
            chunk = channel_ids[i:i + chunk_size]
            if not self.quota.can_afford('channels.list'):
                print("[YouTubeAPI] Quota budget exhausted during channel details fetch.")
                break

            try:
                req = self.youtube.channels().list(
                    id=','.join(chunk),
                    part='snippet,statistics,contentDetails,brandingSettings',
                )
                response = self._execute_with_retry(req)
                self.quota.record_spend('channels.list')

                for ch in response.get('items', []):
                    snippet = ch.get('snippet', {})
                    stats = ch.get('statistics', {})
                    branding = ch.get('brandingSettings', {}).get('channel', {})
                    content = ch.get('contentDetails', {})

                    country = snippet.get('country') or branding.get('country') or ''
                    # uploads playlist id lets us avoid search calls per channel
                    uploads_playlist_id = (
                        content.get('relatedPlaylists', {}).get('uploads') or ''
                    )

                    results.append({
                        'channel_id': ch['id'],
                        'name': snippet.get('title', ''),
                        'description': snippet.get('description', ''),
                        'country': country,
                        'subscriber_count': int(stats.get('subscriberCount', 0)),
                        'video_count': int(stats.get('videoCount', 0)),
                        'view_count': int(stats.get('viewCount', 0)),
                        'custom_url': snippet.get('customUrl', ''),
                        'published_at': snippet.get('publishedAt', ''),
                        'uploads_playlist_id': uploads_playlist_id,
                    })
            except Exception as e:
                if self.quota.is_exhausted:
                    break
                print(f"[-] Error fetching channel details batch: {e}")
                continue

        return results

    # --- Step 3: Fetch Recent Videos & Engagement (quota-efficient) ---
    def get_recent_videos(self, channel_id: str, uploads_playlist_id: Optional[str] = None, max_results: int = 10) -> List[Dict[str, Any]]:
        """
        Fetches recent videos for engagement rate & sponsorship detection.

        Optimised path (0 search units):
          1. Use playlistItems.list on the channel's uploads playlist (1 unit per 50 items).
          2. Then videos.list for stats (1 unit per 50 videos).
          Total cost: 2 units vs the old 101 units (search + videos.list).

        Falls back to the old search-based approach only when the uploads
        playlist ID is unknown and we can't get it from channel details.
        """
        if self.quota.is_exhausted:
            return []

        video_ids: List[str] = []

        # ── Optimised: playlistItems (1 unit) ────────────────────────────
        if uploads_playlist_id and self.quota.can_afford('videos.list'):
            try:
                req_pl = self.youtube.playlistItems().list(
                    playlistId=uploads_playlist_id,
                    part='contentDetails',
                    maxResults=min(max_results, 50),
                )
                pl_res = self._execute_with_retry(req_pl)
                self.quota.record_spend('videos.list')  # playlistItems costs 1 unit
                video_ids = [
                    item['contentDetails']['videoId']
                    for item in pl_res.get('items', [])
                    if item.get('contentDetails', {}).get('videoId')
                ]
            except Exception as e:
                if self.quota.is_exhausted:
                    return []
                print(f"[-] playlistItems fallback for {channel_id}: {e}")

        # ── Legacy fallback: search (100 units) — only if no playlist id ─
        if not video_ids and self.quota.can_afford('search'):
            try:
                req_search = self.youtube.search().list(
                    channelId=channel_id,
                    type='video',
                    part='snippet',
                    order='date',
                    maxResults=max_results,
                )
                search_res = self._execute_with_retry(req_search)
                self.quota.record_spend('search')
                video_ids = [
                    item['id']['videoId']
                    for item in search_res.get('items', [])
                    if item.get('id', {}).get('videoId')
                ]
            except Exception as e:
                if self.quota.is_exhausted:
                    return []
                print(f"[-] Search fallback for recent videos of {channel_id}: {e}")

        if not video_ids:
            return []

        # ── Fetch stats for all video IDs (1 unit per 50) ────────────────
        if not self.quota.can_afford('videos.list'):
            return []
        try:
            req_stats = self.youtube.videos().list(
                id=','.join(video_ids[:50]),
                part='statistics,snippet',
            )
            stats_res = self._execute_with_retry(req_stats)
            self.quota.record_spend('videos.list')
            return stats_res.get('items', [])
        except Exception as e:
            if self.quota.is_exhausted:
                return []
            print(f"[-] Error fetching video stats for {channel_id}: {e}")
            return []

    # --- Strategy 2: Competitor Comment Mining for B2B Buyer Leads ---
    def mine_comments_for_leads(self, video_id: str, max_results: int = 100) -> List[Dict[str, Any]]:
        """Mines comments on competitor videos with rate limit retries."""
        if not self.quota.can_afford('commentThreads.list'):
            return []

        try:
            req = self.youtube.commentThreads().list(
                videoId=video_id,
                part='snippet',
                maxResults=max_results,
                order='relevance'
            )
            response = self._execute_with_retry(req)
            self.quota.record_spend('commentThreads.list')

            intent_signals = []
            for item in response.get('items', []):
                snippet = item['snippet']['topLevelComment']['snippet']
                text = snippet.get('textDisplay', '')
                author_channel = snippet.get('authorChannelId', {}).get('value')
                author_name = snippet.get('authorDisplayName', '')

                text_lower = text.lower()
                matched_patterns = [p for p in INTENT_PATTERNS if p in text_lower]
                if matched_patterns and author_channel:
                    intent_signals.append({
                        'comment': text,
                        'channel_id': author_channel,
                        'author_name': author_name,
                        'intent_patterns': matched_patterns,
                        'intent_type': 'buying_intent' if any(bp in text_lower for bp in ['pricing', 'how much', 'our company', 'we use', 'looking for']) else 'inquiry',
                        'video_id': video_id
                    })

            print(f"[YouTubeAPI] Mined {len(intent_signals)} buyer intent leads from video {video_id}.")
            return intent_signals
        except Exception as e:
            print(f"[-] Error mining comments for video {video_id}: {e}")
            return []


# ==========================================
# 4. ANALYSIS & FILTERING UTILITIES
# ==========================================
def compute_youtube_engagement(videos: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Computes views-based engagement rate on YouTube:
    engagement_rate = (total_likes + total_comments) / total_views
    """
    if not videos:
        return {'avg_views': 0, 'avg_likes': 0, 'avg_comments': 0, 'engagement_rate': 0.0}

    total_views = 0
    total_likes = 0
    total_comments = 0

    for video in videos:
        stats = video.get('statistics', {})
        total_views += int(stats.get('viewCount', 0))
        total_likes += int(stats.get('likeCount', 0))
        total_comments += int(stats.get('commentCount', 0))

    count = len(videos)
    avg_views = total_views / count if count > 0 else 0
    engagement_rate = (total_likes + total_comments) / total_views if total_views > 0 else 0.0

    return {
        'avg_views': round(avg_views, 2),
        'avg_likes': round(total_likes / count, 2),
        'avg_comments': round(total_comments / count, 2),
        'engagement_rate': round(engagement_rate, 4)
    }


def detect_sponsorship_history(videos: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Detects if creator has sponsorship history in recent video descriptions."""
    if not videos:
        return {'has_sponsorship_history': False, 'sponsorship_rate': 0.0, 'signals_found': []}

    sponsored_count = 0
    signals_found = []

    for video in videos:
        desc = video.get('snippet', {}).get('description', '').lower()
        matched = [sig for sig in SPONSORSHIP_SIGNALS if sig in desc]
        if matched:
            sponsored_count += 1
            signals_found.extend(matched)

    rate = sponsored_count / len(videos) if videos else 0.0
    return {
        'has_sponsorship_history': sponsored_count > 0,
        'sponsorship_rate': round(rate, 2),
        'signals_found': list(set(signals_found))
    }


def calculate_upload_frequency(published_at_iso: str, video_count: int) -> float:
    """Calculates average uploads per week (uploadCount / channelAgeInWeeks)."""
    if not published_at_iso:
        return 0.0

    try:
        pub_date = datetime.fromisoformat(published_at_iso.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        age_days = (now - pub_date).days
        weeks = max(age_days / 7.0, 1.0)
        return round(video_count / weeks, 2)
    except Exception:
        return 0.0


# ==========================================
# 5. LANGGRAPH STATE DEFINITION
# ==========================================
class YouTubeAgentState(TypedDict):
    campaign_id: Optional[str]
    campaign_type: str # "creator_discovery" or "buyer_mining"
    icp: Dict[str, Any]
    search_strategy: Dict[str, Any]
    lead_type: str # "creator" or "b2b_buyer"
    quota_budget: int
    
    # Runtime fields
    discovered_channel_ids: List[str]
    raw_channels: List[Dict[str, Any]]
    filtered_channels: List[Dict[str, Any]]
    comment_leads: List[Dict[str, Any]]
    db_leads: List[Dict[str, Any]]          # leads returned from DB cache
    enriched_leads: List[Dict[str, Any]]
    staged_leads: List[Dict[str, Any]]
    error: Optional[str]


# ==========================================
# 6. LANGGRAPH AGENT NODES
# ==========================================
class YouTubeLeadAgent:
    def __init__(self, quota_budget: int = 5000):
        self.quota = YouTubeQuotaManager(daily_budget=quota_budget)
        self.api_client = YouTubeAPIClient(quota_manager=self.quota)
        
        # Build LangGraph workflow
        builder = StateGraph(YouTubeAgentState)
        
        builder.add_node("discover", self.node_discover)
        builder.add_node("batch_fetch", self.node_batch_fetch)
        builder.add_node("pre_filter", self.node_pre_filter)
        builder.add_node("enrich_videos", self.node_enrich_videos)
        builder.add_node("llm_score", self.node_llm_score)
        builder.add_node("persist", self.node_persist)

        builder.set_entry_point("discover")
        builder.add_edge("discover", "batch_fetch")
        builder.add_edge("batch_fetch", "pre_filter")
        builder.add_edge("pre_filter", "enrich_videos")
        builder.add_edge("enrich_videos", "llm_score")
        builder.add_edge("llm_score", "persist")
        builder.add_edge("persist", END)

        self.graph = builder.compile()

    def run(self, input_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Executes the agent graph with the given payload."""
        state_input: YouTubeAgentState = {
            "campaign_id": input_payload.get("campaign_id"),
            "campaign_type": input_payload.get("campaign_type", "creator_discovery"),
            "icp": input_payload.get("icp", {}),
            "search_strategy": input_payload.get("search_strategy", {}),
            "lead_type": input_payload.get("lead_type", "creator"),
            "quota_budget": input_payload.get("quota_budget", 5000),
            "discovered_channel_ids": [],
            "raw_channels": [],
            "filtered_channels": [],
            "comment_leads": [],
            "db_leads": [],
            "enriched_leads": [],
            "staged_leads": [],
            "error": None
        }

        return self.graph.invoke(state_input)

    # --- Node 1: Discover Channels (DB-first, then API) ---
    def node_discover(self, state: YouTubeAgentState) -> Dict[str, Any]:
        print("[Node 1: Discover] Executing discovery strategies...")
        strategy = state.get("search_strategy", {})
        icp = state.get("icp", {})
        campaign_id = state.get("campaign_id")
        channel_ids: Set[str] = set(strategy.get("seed_channels", []))
        comment_leads: List[Dict[str, Any]] = []

        # ── DB-first: serve from cache when quota is tight ────────────────
        niche_str = " ".join(icp.get("niche", [])) if isinstance(icp.get("niche"), list) else (icp.get("niche") or "")
        target_count = state.get("icp", {}).get("target_lead_count", 10)
        geo_target = icp.get("geo_country") or ""

        db_leads = search_existing_leads_by_niche_sync(
            icp=icp,
            niche=niche_str,
            limit=target_count * 2,
            geo_target=geo_target,
            platform="youtube",
            campaign_id=campaign_id,
        )
        print(f"[Node 1: Discover] DB cache returned {len(db_leads)} existing YouTube leads.")

        # If we already have enough leads from DB, skip expensive API searches
        if len(db_leads) >= target_count:
            print("[Node 1: Discover] DB cache satisfied target — skipping YouTube API searches.")
            return {
                "discovered_channel_ids": [],
                "comment_leads": [],
                "db_leads": db_leads,
            }

        # ── Keyword deduplication (avoid paying 100 units twice for similar terms) ──
        keywords: List[str] = strategy.get("keywords", [])
        if not keywords and isinstance(icp.get("niche"), list):
            keywords = icp["niche"]
        elif not keywords and isinstance(icp.get("niche"), str):
            keywords = [icp["niche"]]

        # Deduplicate: skip keywords that are pure substrings of another keyword
        def _dedupe_keywords(kws: List[str]) -> List[str]:
            out, seen_lower = [], set()
            for kw in kws:
                kl = kw.lower().strip()
                if kl and kl not in seen_lower:
                    # Skip if this kw is fully contained in an already-chosen one
                    if not any(kl in s for s in seen_lower):
                        seen_lower.add(kl)
                        out.append(kw)
            return out

        keywords = _dedupe_keywords(keywords)
        geo_country = icp.get("geo_country")

        # Cap to 3 keyword searches = 300 units max
        for kw in keywords[:3]:
            if self.quota.is_exhausted:
                print("[Node 1: Discover] Quota exhausted mid-search — stopping.")
                break
            found = self.api_client.search_channels(keyword=kw, max_results=50, geo_country=geo_country)
            channel_ids.update(found)

        # ── Competitor comment mining ─────────────────────────────────────
        for vid in strategy.get("competitor_videos", [])[:2]:
            if self.quota.is_exhausted:
                break
            mined = self.api_client.mine_comments_for_leads(video_id=vid, max_results=100)
            comment_leads.extend(mined)
            for item in mined:
                if item.get("channel_id"):
                    channel_ids.add(item["channel_id"])

        print(f"[Node 1: Discover] Total unique channels discovered: {len(channel_ids)}")
        return {
            "discovered_channel_ids": list(channel_ids),
            "comment_leads": comment_leads,
            "db_leads": db_leads,
        }

    # --- Node 2: Batch Fetch Channel Details ---
    def node_batch_fetch(self, state: YouTubeAgentState) -> Dict[str, Any]:
        channel_ids = state.get("discovered_channel_ids", [])
        print(f"[Node 2: Batch Fetch] Fetching details for {len(channel_ids)} channels...")
        raw_channels = self.api_client.get_channel_details(channel_ids)
        return {"raw_channels": raw_channels}

    # --- Node 3: Pre-LLM Pre-Filtering ---
    def node_pre_filter(self, state: YouTubeAgentState) -> Dict[str, Any]:
        raw_channels = state.get("raw_channels", [])
        icp = state.get("icp", {})
        sub_range = icp.get("subscriber_range", {"min": 1000, "max": 1000000})
        target_country = (icp.get("geo_country") or "").upper().strip()

        min_subs = sub_range.get("min", 1000)
        max_subs = sub_range.get("max", 1000000)

        qualifying = []
        for ch in raw_channels:
            subs = ch.get("subscriber_count", 0)
            if not (min_subs <= subs <= max_subs):
                continue

            ch_country = (ch.get("country") or "").upper().strip()
            if target_country and ch_country and ch_country != target_country:
                continue

            # Upload frequency check
            freq = calculate_upload_frequency(ch.get("published_at"), ch.get("video_count", 0))
            ch["upload_frequency_per_week"] = freq

            qualifying.append(ch)

        print(f"[Node 3: Pre-Filter] {len(qualifying)} out of {len(raw_channels)} channels passed pre-filters.")
        return {"filtered_channels": qualifying}

    # --- Node 4: Deep Video & Engagement Enrichment ---
    def node_enrich_videos(self, state: YouTubeAgentState) -> Dict[str, Any]:
        channels = state.get("filtered_channels", [])
        comment_leads = state.get("comment_leads", [])
        comment_map = {cl["channel_id"]: cl for cl in comment_leads}

        enriched = []
        print(f"[Node 4: Enrich Videos] Enriching engagement & sponsorship history for {len(channels)} channels...")

        for ch in channels:
            if self.quota.is_exhausted:
                print("[Node 4: Enrich Videos] Quota exhausted — stopping enrichment early.")
                break

            cid = ch["channel_id"]
            uploads_playlist_id = ch.get("uploads_playlist_id") or None
            # Optimised: use playlist ID to avoid 100-unit search calls
            recent_vids = self.api_client.get_recent_videos(
                cid, uploads_playlist_id=uploads_playlist_id, max_results=10
            )
            engagement = compute_youtube_engagement(recent_vids)
            sponsorship = detect_sponsorship_history(recent_vids)

            # Contact info extraction
            desc = ch.get("description", "")
            video_descs = " ".join([v.get("snippet", {}).get("description", "") for v in recent_vids[:3]])
            combined_text = f"{desc} {video_descs}"

            email = extract_email(combined_text)
            websites = extract_website_links(combined_text)

            recent_video_snippets = [{
                'id': v.get('id', ''),
                'title': v.get('snippet', {}).get('title', ''),
                'views': int(v.get('statistics', {}).get('viewCount', 0)),
                'likes': int(v.get('statistics', {}).get('likeCount', 0)),
                'comments': int(v.get('statistics', {}).get('commentCount', 0))
            } for v in recent_vids[:5]]

            lead_obj = {
                "channel_id": cid,
                "username": ch.get("custom_url") or cid,
                "custom_url": ch.get("custom_url", ""),
                "name": ch.get("name", ""),
                "description": desc,
                "country": ch.get("country", ""),
                "geo_country": ch.get("country", ""),
                "subscriber_count": ch.get("subscriber_count", 0),
                "followers": ch.get("subscriber_count", 0),
                "video_count": ch.get("video_count", 0),
                "avg_views": engagement.get("avg_views", 0),
                "engagement_rate": engagement.get("engagement_rate", 0.0),
                "sponsorship_history": sponsorship,
                "email": email,
                "website": websites[0] if websites else None,
                "recent_videos": recent_video_snippets,
                "creator_info": f"YouTube Creator '{ch.get('name')}' ({ch.get('subscriber_count')} subs, {engagement.get('avg_views')} avg views)",
                "reasoning": f"Qualifies ICP. Engagement: {engagement.get('engagement_rate'):.1%}. Sponsorship History: {sponsorship.get('has_sponsorship_history')}"
            }

            # Attach comment intent if B2B buyer lead
            if cid in comment_map:
                lead_obj["intent_type"] = comment_map[cid].get("intent_type")
                lead_obj["comment"] = comment_map[cid].get("comment")
                lead_obj["reasoning"] += f" | Warm buyer lead intent comment: '{comment_map[cid].get('comment')[:80]}'"

            enriched.append(lead_obj)

        return {"enriched_leads": enriched}

    # --- Node 5: LLM Validation & Scoring ---
    def node_llm_score(self, state: YouTubeAgentState) -> Dict[str, Any]:
        leads = state.get("enriched_leads", [])
        icp = state.get("icp", {})
        target_count = state.get("target_lead_count", 5)
        staged = []

        print(f"[Node 5: LLM Score] Validating {len(leads)} enriched leads against ICP...")
        if not leads:
            return {"staged_leads": []}

        # Cap leads to avoid unnecessary LLM drain (max target_count * 2)
        max_candidates = max(target_count * 2, 10)
        if len(leads) > max_candidates:
            # Sort by subscriber count and avg_views descending
            leads = sorted(leads, key=lambda x: (x.get("subscriber_count", 0), x.get("avg_views", 0)), reverse=True)[:max_candidates]
            print(f"[Node 5: LLM Score] Capped candidates to top {len(leads)} leads for LLM validation.")

        groq_api_key = os.getenv("GROQ_API_KEY") or os.getenv("GROQ_API_KEY_1")
        llm = None
        if groq_api_key:
            try:
                check_groq_availability()
                llm = get_groq_llm()
            except GroqQuotaExhaustedError:
                raise
            except Exception as e:
                print(f"[-] LLM initialization warning: {e}")

        if not llm:
            print("[Node 5: LLM Score] No LLM available, staging all candidate leads.")
            return {"staged_leads": leads}

        # Process leads in batches of 5 to minimize LLM API calls and prevent rate limits
        batch_size = 5
        for i in range(0, len(leads), batch_size):
            batch = leads[i:i + batch_size]
            batch_summaries = []
            for idx, lead in enumerate(batch):
                batch_summaries.append({
                    "batch_index": idx,
                    "name": lead.get("name"),
                    "subscribers": lead.get("subscriber_count"),
                    "avg_views": lead.get("avg_views"),
                    "country": lead.get("country"),
                    "description": (lead.get("description") or "")[:250],
                    "sponsorship_history": lead.get("sponsorship_history")
                })

            prompt = f"""
            Evaluate these YouTube leads against the Campaign ICP:
            ICP: {json.dumps(icp)}

            Leads Batch:
            {json.dumps(batch_summaries, indent=2)}

            Output a JSON array of objects for each lead in the batch:
            [
              {{
                "batch_index": 0,
                "is_match": true/false,
                "creator_info": "concise summary",
                "reasoning": "why it matches or fails ICP"
              }}
            ]
            """

            # Execute LLM call with retry; Groq 429 immediately requeues the job
            res_content = None
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    res = llm.invoke(prompt)
                    res_content = res.content.strip()
                    break
                except GroqQuotaExhaustedError:
                    raise
                except Exception as e:
                    if looks_like_groq_limit(e):
                        raise_groq_quota_from_error(e)
                    print(f"[-] LLM batch invoke error: {e}")
                    break

            if res_content:
                try:
                    clean_res = res_content
                    if "```json" in clean_res:
                        clean_res = clean_res.split("```json")[1].split("```")[0].strip()
                    elif "```" in clean_res:
                        clean_res = clean_res.split("```")[1].split("```")[0].strip()

                    parsed_list = json.loads(clean_res, strict=False)
                    if isinstance(parsed_list, list):
                        eval_map = {item.get("batch_index"): item for item in parsed_list if isinstance(item, dict)}
                        for idx, lead in enumerate(batch):
                            eval_item = eval_map.get(idx)
                            if eval_item:
                                if eval_item.get("is_match", True):
                                    lead["creator_info"] = eval_item.get("creator_info", lead.get("creator_info"))
                                    lead["reasoning"] = eval_item.get("reasoning", lead.get("reasoning"))
                                    staged.append(lead)
                            else:
                                staged.append(lead)
                    else:
                        staged.extend(batch)
                except Exception as parse_err:
                    print(f"[-] Error parsing LLM batch response: {parse_err}. Fallback to staging batch.")
                    staged.extend(batch)
            else:
                staged.extend(batch)

            # Mandatory 2.0-second delay between LLM batch requests to protect API quota
            if i + batch_size < len(leads):
                time.sleep(2.0)

        print(f"[Node 5: LLM Score] {len(staged)} leads approved.")
        return {"staged_leads": staged}

    # --- Node 6: Database Persistence ---
    def node_persist(self, state: YouTubeAgentState) -> Dict[str, Any]:
        staged = state.get("staged_leads", [])
        db_leads = state.get("db_leads", [])
        campaign_id = state.get("campaign_id")
        icp = state.get("icp", {})
        niche = ""
        if isinstance(icp.get("niche"), list):
            niche = " ".join(icp["niche"])
        elif isinstance(icp.get("niche"), str):
            niche = icp["niche"]

        # Merge DB cache leads: add any that aren't already in staged (by username/channel_id)
        staged_ids = {
            (l.get("channel_id") or l.get("username", "")).lower()
            for l in staged
        }
        for dl in db_leads:
            key = (dl.get("channel_id") or dl.get("username", "")).lower()
            if key and key not in staged_ids:
                staged.append(dl)
                staged_ids.add(key)

        print(f"[Node 6: Persist] Saving {len(staged)} YouTube leads to Supabase (platform='youtube')...")
        try:
            # Only persist leads that came from fresh API discovery (not DB cache re-hits)
            fresh_leads = [l for l in staged if not l.get("from_db")]
            if fresh_leads:
                save_leads_to_supabase_sync(leads=fresh_leads, campaign_id=campaign_id, niche=niche, platform="youtube")
            # For DB leads we just need to re-link them to this campaign
            db_only = [l for l in staged if l.get("from_db")]
            if db_only and campaign_id:
                save_leads_to_supabase_sync(leads=db_only, campaign_id=campaign_id, niche=niche, platform="youtube")
        except Exception as e:
            print(f"[-] Error in YouTube lead persistence: {e}")
            return {"error": str(e), "staged_leads": staged}

        return {"staged_leads": staged}
