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


# ==========================================
# 1. QUOTA MANAGER
# ==========================================
class YouTubeQuotaManager:
    """
    Tracks daily YouTube Data API v3 quota spend per agent execution.
    - search: 100 units
    - channels.list: 1 unit per request (up to 50 channels batch)
    - videos.list: 1 unit per request (up to 50 videos batch)
    - commentThreads.list: 1 unit per request
    """
    COSTS = {
        'search': 100,
        'channels.list': 1,
        'videos.list': 1,
        'commentThreads.list': 1
    }

    def __init__(self, daily_budget: int = 5000):
        self.budget = daily_budget
        self.spent = 0

    def can_afford(self, operation: str, count: int = 1) -> bool:
        cost = self.COSTS.get(operation, 1) * count
        return (self.spent + cost) <= self.budget

    def record_spend(self, operation: str, count: int = 1):
        cost = self.COSTS.get(operation, 1) * count
        self.spent += cost
        print(f"[QuotaManager] Operation '{operation}' (x{count}) cost {cost} units. Total spent: {self.spent}/{self.budget}")


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

    # --- Strategy 1: Keyword Search ---
    def search_channels(self, keyword: str, max_results: int = 50, geo_country: Optional[str] = None) -> List[str]:
        """Performs YouTube API channel search by keyword."""
        if not self.quota.can_afford('search'):
            print("[YouTubeAPI] Out of quota budget for search operation.")
            return []

        try:
            kwargs = {
                'q': keyword,
                'type': 'channel',
                'part': 'snippet',
                'maxResults': min(max_results, 50),
                'relevanceLanguage': 'en'
            }
            if geo_country and len(geo_country) == 2:
                kwargs['regionCode'] = geo_country.upper()

            response = self.youtube.search().list(**kwargs).execute()
            self.quota.record_spend('search')

            channel_ids = [item['snippet']['channelId'] for item in response.get('items', []) if 'snippet' in item and 'channelId' in item['snippet']]
            print(f"[YouTubeAPI] Keyword search '{keyword}' found {len(channel_ids)} channels.")
            return channel_ids
        except Exception as e:
            print(f"[-] Error searching channels for keyword '{keyword}': {e}")
            return []

    # --- Step 2: Batch Channel Details (up to 50 per request) ---
    def get_channel_details(self, channel_ids: List[str]) -> List[Dict[str, Any]]:
        """Batch fetches channel details (50 per call)."""
        if not channel_ids:
            return []

        results = []
        # Chunk into 50s
        chunk_size = 50
        for i in range(0, len(channel_ids), chunk_size):
            chunk = channel_ids[i:i + chunk_size]
            if not self.quota.can_afford('channels.list'):
                print("[YouTubeAPI] Quota budget exhausted during channel details fetch.")
                break

            try:
                response = self.youtube.channels().list(
                    id=','.join(chunk),
                    part='snippet,statistics,contentDetails,brandingSettings'
                ).execute()
                self.quota.record_spend('channels.list')

                for ch in response.get('items', []):
                    snippet = ch.get('snippet', {})
                    stats = ch.get('statistics', {})
                    branding = ch.get('brandingSettings', {}).get('channel', {})

                    # Extract country directly from snippet or branding
                    country = snippet.get('country') or branding.get('country') or ''

                    results.append({
                        'channel_id': ch['id'],
                        'name': snippet.get('title', ''),
                        'description': snippet.get('description', ''),
                        'country': country,
                        'subscriber_count': int(stats.get('subscriberCount', 0)),
                        'video_count': int(stats.get('videoCount', 0)),
                        'view_count': int(stats.get('viewCount', 0)),
                        'custom_url': snippet.get('customUrl', ''),
                        'published_at': snippet.get('publishedAt', '')
                    })
            except Exception as e:
                print(f"[-] Error fetching channel details batch: {e}")
                continue

        return results

    # --- Step 3: Fetch Recent Videos & Engagement ---
    def get_recent_videos(self, channel_id: str, max_results: int = 10) -> List[Dict[str, Any]]:
        """Fetches recent videos for engagement rate & sponsorship detection."""
        if not self.quota.can_afford('search'):
            return []

        try:
            search_res = self.youtube.search().list(
                channelId=channel_id,
                type='video',
                part='snippet',
                order='date',
                maxResults=max_results
            ).execute()
            self.quota.record_spend('search')

            video_ids = [item['id']['videoId'] for item in search_res.get('items', []) if item.get('id', {}).get('videoId')]
            if not video_ids:
                return []

            if not self.quota.can_afford('videos.list'):
                return []

            stats_res = self.youtube.videos().list(
                id=','.join(video_ids),
                part='statistics,snippet'
            ).execute()
            self.quota.record_spend('videos.list')

            return stats_res.get('items', [])
        except Exception as e:
            print(f"[-] Error fetching recent videos for channel {channel_id}: {e}")
            return []

    # --- Strategy 2: Competitor Comment Mining for B2B Buyer Leads ---
    def mine_comments_for_leads(self, video_id: str, max_results: int = 100) -> List[Dict[str, Any]]:
        """Mines comments on competitor videos to discover warm B2B buyer leads."""
        if not self.quota.can_afford('commentThreads.list'):
            return []

        try:
            response = self.youtube.commentThreads().list(
                videoId=video_id,
                part='snippet',
                maxResults=max_results,
                order='relevance'
            ).execute()
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
            "enriched_leads": [],
            "staged_leads": [],
            "error": None
        }

        return self.graph.invoke(state_input)

    # --- Node 1: Discover Channels & Video Comments ---
    def node_discover(self, state: YouTubeAgentState) -> Dict[str, Any]:
        print("[Node 1: Discover] Executing discovery strategies...")
        strategy = state.get("search_strategy", {})
        icp = state.get("icp", {})
        channel_ids = set(strategy.get("seed_channels", []))
        comment_leads = []

        # 1. Keyword search strategy
        keywords = strategy.get("keywords", [])
        if not keywords and isinstance(icp.get("niche"), list):
            keywords = icp["niche"]
        elif not keywords and isinstance(icp.get("niche"), str):
            keywords = [icp["niche"]]

        geo_country = icp.get("geo_country")

        for kw in keywords[:3]: # limit searches to conserve quota
            found = self.api_client.search_channels(keyword=kw, max_results=50, geo_country=geo_country)
            channel_ids.update(found)

        # 2. Competitor Video Comment Mining strategy
        competitor_videos = strategy.get("competitor_videos", [])
        for vid in competitor_videos[:3]:
            mined = self.api_client.mine_comments_for_leads(video_id=vid, max_results=100)
            comment_leads.extend(mined)
            for item in mined:
                if item.get("channel_id"):
                    channel_ids.add(item["channel_id"])

        print(f"[Node 1: Discover] Total unique channels discovered: {len(channel_ids)}")
        return {
            "discovered_channel_ids": list(channel_ids),
            "comment_leads": comment_leads
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
            cid = ch["channel_id"]
            recent_vids = self.api_client.get_recent_videos(cid, max_results=10)
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
        staged = []

        print(f"[Node 5: LLM Score] Validating {len(leads)} enriched leads against ICP...")

        groq_api_key = os.getenv("GROQ_API_KEY")
        llm = None
        if groq_api_key:
            try:
                llm = ChatGroq(model_name="llama-3.1-8b-instant", groq_api_key=groq_api_key, temperature=0.1)
            except Exception as e:
                print(f"[-] LLM initialization warning: {e}")

        for lead in leads:
            if llm:
                try:
                    prompt = f"""
                    Evaluate this YouTube lead against the Campaign ICP:
                    ICP: {json.dumps(icp)}
                    Lead Name: {lead.get('name')}
                    Subscribers: {lead.get('subscriber_count')}
                    Avg Views: {lead.get('avg_views')}
                    Country: {lead.get('country')}
                    Bio/Description: {lead.get('description')[:300]}
                    Sponsorship History: {lead.get('sponsorship_history')}

                    Output JSON:
                    {{
                        "is_match": true/false,
                        "creator_info": "concise summary",
                        "reasoning": "why it matches or fails"
                    }}
                    """
                    res = llm.invoke(prompt)
                    clean_res = res.content.strip()
                    if "```json" in clean_res:
                        clean_res = clean_res.split("```json")[1].split("```")[0].strip()
                    parsed = json.loads(clean_res, strict=False)

                    if parsed.get("is_match", True):
                        lead["creator_info"] = parsed.get("creator_info", lead["creator_info"])
                        lead["reasoning"] = parsed.get("reasoning", lead["reasoning"])
                        staged.append(lead)
                except Exception as e:
                    print(f"[-] LLM scoring fallback for @{lead.get('name')}: {e}")
                    staged.append(lead)
            else:
                staged.append(lead)

        print(f"[Node 5: LLM Score] {len(staged)} leads approved.")
        return {"staged_leads": staged}

    # --- Node 6: Database Persistence ---
    def node_persist(self, state: YouTubeAgentState) -> Dict[str, Any]:
        staged = state.get("staged_leads", [])
        campaign_id = state.get("campaign_id")
        icp = state.get("icp", {})
        niche = ""
        if isinstance(icp.get("niche"), list):
            niche = " ".join(icp["niche"])
        elif isinstance(icp.get("niche"), str):
            niche = icp["niche"]

        print(f"[Node 6: Persist] Saving {len(staged)} YouTube leads to Supabase (platform='youtube')...")
        try:
            save_leads_to_supabase_sync(leads=staged, campaign_id=campaign_id, niche=niche, platform="youtube")
        except Exception as e:
            print(f"[-] Error in YouTube lead persistence: {e}")
            return {"error": str(e)}

        return {"staged_leads": staged}
