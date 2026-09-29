"""
MasterAgent — Orchestrates Instagram, YouTube, and ProductHunt sub-agents.

Receives ICP payloads from the web-app via `master-queue` (BullMQ),
transforms the ICP into each sub-agent's expected format, runs all three
concurrently, and pushes each sub-agent's results into its own BullMQ
result queue.
"""

import os
import sys
import json
import asyncio
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, List, Optional

import bullmq
from bullmq import Queue
from dotenv import load_dotenv

# --- Ensure parent is on path for utils imports ---
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
load_dotenv()


# ============================================================
# ICP → Sub-Agent Payload Transformers
# ============================================================

def _build_instagram_payload(icp: Dict[str, Any], campaign_id: Optional[str]) -> Dict[str, Any]:
    """
    Transforms the web-app ICP into the initial state expected by
    ``create_instagram_graph().invoke(state)``.
    """
    target_lead_count = icp.get("target_lead_count", 10)
    icp_copy = dict(icp)
    if campaign_id:
        icp_copy["campaignId"] = campaign_id
        icp_copy["campaign_id"] = campaign_id

    return {
        "campaign_id": campaign_id,
        "icp": icp_copy,
        "niche": "",                       # derived by derive_niche_node
        "item_profile": {
            "item_to_sell": icp.get("campaignName", ""),
            "target_audience": icp.get("targetProfile", ""),
        },
        "hashtags": [],
        "discovered_posts": [],
        "usernames_to_enrich": [],
        "profiles_data": [],
        "staged_leads": [],
        "catalogue_profiles": [],
        "db_leads": [],
        "needs_browser_search": True,
        "target_lead_count": target_lead_count,
        "error": None,
    }


def _build_youtube_payload(icp: Dict[str, Any], campaign_id: Optional[str]) -> Dict[str, Any]:
    """
    Transforms the web-app ICP into the payload expected by
    ``YouTubeLeadAgent.run(payload)``.
    """
    industry = icp.get("industry", "")
    target_profile = icp.get("targetProfile", "")
    focus = icp.get("focus", "")

    # Build comprehensive search keywords from industry, targetProfile, and focus
    raw_kw = f"{industry} {target_profile} {focus}"
    niche_keywords = [kw.strip() for kw in raw_kw.replace(",", " ").split() if len(kw.strip()) > 2]
    
    # Preserve key multi-word phrases from industry / targetProfile
    phrase_keywords = [kw.strip() for kw in f"{industry},{target_profile}".split(",") if kw.strip()]
    all_keywords = list(dict.fromkeys(phrase_keywords + niche_keywords))

    target_lead_count = icp.get("target_lead_count", 20)

    return {
        "campaign_id": campaign_id,
        "campaign_type": "creator_discovery",
        "icp": {
            "industry": industry,
            "targetProfile": target_profile,
            "focus": focus,
            "niche": all_keywords or [industry or "tech"],
            "subscriber_range": {"min": 1000, "max": 1_000_000},
            "geo_country": _extract_geo_country(icp.get("geoTarget", "")),
            "target_lead_count": target_lead_count,
            "exclusions": icp.get("exclusions", ""),
            "b2bSignals": icp.get("b2bSignals", []),
        },
        "search_strategy": {
            "keywords": all_keywords[:5],
            "seed_channels": [],
            "competitor_videos": [],
        },
        "lead_type": "creator",
        "target_lead_count": target_lead_count,
        "quota_budget": 5000,
    }


def _build_producthunt_payload(icp: Dict[str, Any], campaign_id: Optional[str]) -> Dict[str, Any]:
    """
    Transforms the web-app ICP into the payload expected by
    ``ProductHuntLeadAgent.run(payload)``.
    """
    industry = icp.get("industry", "")
    target_profile = icp.get("targetProfile", "")
    focus = icp.get("focus", "")

    # Extract distinct clean topic slugs from industry, targetProfile, and focus
    raw_topics = f"{industry},{target_profile},{focus}".split(",")
    topics = []
    for t in raw_topics:
        cleaned = t.strip().lower().replace(" ", "-")
        if cleaned and len(cleaned) > 2 and cleaned not in topics:
            topics.append(cleaned)

    # Standard fallback topics if empty
    if not topics:
        topics = ["saas", "tech"]

    return {
        "campaign_id": campaign_id,
        "icp": {
            "industry": industry,
            "targetProfile": target_profile,
            "focus": focus,
            "niche": industry or target_profile or "tech",
            "exclusions": icp.get("exclusions", ""),
        },
        "topics": topics[:4],
        "competitor_product_ids": [],
        "target_lead_count": icp.get("target_lead_count", 10),
    }


def _extract_geo_country(geo_target: str) -> Optional[str]:
    """
    Best-effort extraction of a 2-letter ISO country code from the
    free-text geoTarget field filled in by the user.
    """
    if not geo_target:
        return None
    geo_lower = geo_target.strip().lower()
    country_map = {
        "united states": "US", "usa": "US", "us": "US", "north america": "US",
        "united kingdom": "GB", "uk": "GB", "great britain": "GB",
        "india": "IN", "germany": "DE", "france": "FR", "canada": "CA",
        "australia": "AU", "japan": "JP", "brazil": "BR", "spain": "ES",
    }
    for key, code in country_map.items():
        if key in geo_lower:
            return code
    # If it looks like an ISO code already
    if len(geo_lower) == 2 and geo_lower.isalpha():
        return geo_lower.upper()
    return None


# ============================================================
# Result Queue Publisher
# ============================================================

async def _push_to_result_queue(queue_name: str, results: Dict[str, Any], redis_url: str):
    """Pushes sub-agent results into a dedicated BullMQ result queue."""
    try:
        result_queue = Queue(queue_name, {"connection": redis_url})
        await result_queue.add(
            f"{queue_name}-{results.get('campaign_id', 'unknown')}",
            results,
        )
        print(f"[MasterAgent] ✓ Pushed {results.get('lead_count', 0)} results to {queue_name}")
        await result_queue.close()
    except Exception as e:
        print(f"[MasterAgent] ✗ Failed to push to {queue_name}: {e}")


# ============================================================
# Sub-Agent Runners (executed in ThreadPool)
# ============================================================

def _run_instagram(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Runs the Instagram agent synchronously in its own thread."""
    print("[MasterAgent] → Starting Instagram agent...")
    try:
        from agents.instagram.instagram_agent import create_instagram_graph
        graph = create_instagram_graph()
        final_state = graph.invoke(payload)
        leads = final_state.get("staged_leads", [])
        print(f"[MasterAgent] ← Instagram agent finished with {len(leads)} leads")
        return {
            "platform": "instagram",
            "leads": leads,
            "lead_count": len(leads),
            "error": final_state.get("error"),
        }
    except Exception as e:
        print(f"[MasterAgent] ✗ Instagram agent error: {e}")
        traceback.print_exc()
        return {"platform": "instagram", "leads": [], "lead_count": 0, "error": str(e)}


def _run_youtube(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Runs the YouTube agent synchronously and returns its results."""
    print("[MasterAgent] → Starting YouTube agent...")
    try:
        from agents.youtube import YouTubeLeadAgent
        agent = YouTubeLeadAgent(quota_budget=payload.get("quota_budget", 2000))
        result = agent.run(payload)
        leads = result.get("staged_leads", [])
        print(f"[MasterAgent] ← YouTube agent finished with {len(leads)} leads")
        return {
            "platform": "youtube",
            "leads": leads,
            "lead_count": len(leads),
            "error": result.get("error"),
        }
    except Exception as e:
        print(f"[MasterAgent] ✗ YouTube agent error: {e}")
        traceback.print_exc()
        return {"platform": "youtube", "leads": [], "lead_count": 0, "error": str(e)}


def _run_producthunt(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Runs the ProductHunt agent synchronously and returns its results."""
    print("[MasterAgent] → Starting ProductHunt agent...")
    try:
        from agents.producthunt import ProductHuntLeadAgent
        agent = ProductHuntLeadAgent()
        result = agent.run(payload)
        leads = result.get("scored_leads", [])
        print(f"[MasterAgent] ← ProductHunt agent finished with {len(leads)} leads")
        return {
            "platform": "producthunt",
            "leads": leads,
            "lead_count": len(leads),
            "error": result.get("error"),
        }
    except Exception as e:
        print(f"[MasterAgent] ✗ ProductHunt agent error: {e}")
        traceback.print_exc()
        return {"platform": "producthunt", "leads": [], "lead_count": 0, "error": str(e)}


# ============================================================
# Master Agent
# ============================================================

class MasterAgent:
    """
    Orchestrator that receives an ICP from ``master-queue`` and fans out
    to Instagram, YouTube, and ProductHunt sub-agents concurrently.

    Each sub-agent's results are pushed to its own BullMQ result queue:
      - ``instagram-results-queue``
      - ``youtube-results-queue``
      - ``producthunt-results-queue``
    """

    PLATFORM_RUNNERS = {
        "instagram": (_run_instagram, _build_instagram_payload, "instagram-results-queue"),
        "youtube":   (_run_youtube,   _build_youtube_payload,   "youtube-results-queue"),
        "producthunt": (_run_producthunt, _build_producthunt_payload, "producthunt-results-queue"),
    }

    def __init__(self, job: bullmq.Job):
        self.job = job
        url = os.getenv("UPSTASH_REDIS_URL") or os.getenv("REDIS_URL")
        if not url:
            rest_url = os.getenv("UPSTASH_REDIS_REST_URL")
            rest_token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
            if rest_url:
                host = rest_url.replace("https://", "").replace("http://", "").strip("/")
                url = f"rediss://default:{rest_token}@{host}:6379" if rest_token else f"rediss://{host}:6379"
        self.redis_url = url or "redis://localhost:6379"

    async def run(self):
        """Main execution entry point called by the BullMQ worker."""
        job_data = self.job.data
        campaign_id = job_data.get("jobId") or job_data.get("campaign_id")
        icp = self._extract_icp(job_data)

        print("=" * 60)
        print(f"[MasterAgent] Received campaign: {icp.get('campaignName', 'Unnamed')}")
        print(f"[MasterAgent] Industry: {icp.get('industry')}")
        print(f"[MasterAgent] GeoTarget: {icp.get('geoTarget')}")
        print(f"[MasterAgent] TargetProfile: {icp.get('targetProfile')}")
        print("=" * 60)

        await self.job.updateProgress({
            "status": "running",
            "message": "Master agent started — dispatching to sub-agents...",
        })

        # ----- Build payloads for each platform -----
        payloads = {}
        for platform, (runner, builder, queue_name) in self.PLATFORM_RUNNERS.items():
            payloads[platform] = {
                "payload": builder(icp, campaign_id),
                "runner": runner,
                "queue_name": queue_name,
            }

        # ----- Fan-out: run all sub-agents concurrently -----
        all_results: Dict[str, Dict[str, Any]] = {}

        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=3, thread_name_prefix="agent") as pool:
            tasks = []
            platforms = list(payloads.keys())
            
            for platform in platforms:
                info = payloads[platform]
                fut = loop.run_in_executor(pool, info["runner"], info["payload"])
                tasks.append((platform, info["queue_name"], fut))

            for platform, queue_name, fut in tasks:
                try:
                    result = await fut
                    result["campaign_id"] = campaign_id
                    all_results[platform] = result

                    # Push to platform-specific result queue
                    await _push_to_result_queue(queue_name, result, self.redis_url)

                    await self.job.updateProgress({
                        "status": "running",
                        "message": f"{platform} agent completed — {result.get('lead_count', 0)} leads found",
                        "platform_done": platform,
                        "lead_count": result.get("lead_count", 0),
                    })
                except Exception as e:
                    print(f"[MasterAgent] ✗ Error awaiting {platform}: {e}")
                    traceback.print_exc()
                    all_results[platform] = {
                        "platform": platform,
                        "leads": [],
                        "lead_count": 0,
                        "error": str(e),
                        "campaign_id": campaign_id,
                    }

        # ----- Summary -----
        total_leads = sum(r.get("lead_count", 0) for r in all_results.values())
        summary = {
            platform: {
                "lead_count": r.get("lead_count", 0),
                "error": r.get("error"),
            }
            for platform, r in all_results.items()
        }

        print("\n" + "=" * 60)
        print(f"[MasterAgent] ALL AGENTS COMPLETE — Total leads: {total_leads}")
        for plat, info in summary.items():
            status = "✓" if not info["error"] else "✗"
            print(f"  {status} {plat}: {info['lead_count']} leads")
        print("=" * 60)

        await self.job.updateProgress({
            "status": "completed",
            "message": f"All agents finished — {total_leads} total leads generated",
            "summary": summary,
            "total_leads": total_leads,
        })

    @staticmethod
    def _extract_icp(job_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extracts the ICP dict from the job data. The web-app spreads the
        form fields directly into jobBody, so job_data IS the ICP (plus
        some meta keys like jobId, jobType, userId).
        """
        # The ICP fields live at the top level of job_data
        return {
            "campaignName": job_data.get("campaignName", ""),
            "goalType": job_data.get("goalType", "Lead Generation"),
            "industry": job_data.get("industry", ""),
            "geoTarget": job_data.get("geoTarget", ""),
            "budget": job_data.get("budget", ""),
            "targetProfile": job_data.get("targetProfile", ""),
            "focus": job_data.get("focus", "B2B"),
            "minFollowers": job_data.get("minFollowers", ""),
            "exclusions": job_data.get("exclusions", ""),
            "b2bSignals": job_data.get("b2bSignals", []),
            "minEngagement": job_data.get("minEngagement", ""),
            "contentType": job_data.get("contentType", ""),
            "channels": job_data.get("channels", []),
            "tone": job_data.get("tone", ""),
            "sequence": job_data.get("sequence", ""),
            "companyId": job_data.get("companyId"),
            "userId": job_data.get("userId"),
            "target_lead_count": 10,
        }
