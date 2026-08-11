import os
import sys
import json
from dotenv import load_dotenv

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
load_dotenv()

from agents.youtube import YouTubeLeadAgent, YouTubeQuotaManager

def test_youtube_agent():
    print("==========================================")
    print("Testing YouTube Lead Generation Agent Flow")
    print("==========================================")
    
    api_key = os.getenv("YOUTUBE_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("[-] Skipping live API test: Neither YOUTUBE_API_KEY nor GOOGLE_API_KEY is present in environment.")
        return

    payload = {
        "campaign_id": None,
        "campaign_type": "creator_discovery",
        "icp": {
            "niche": ["productivity tools", "SaaS review"],
            "subscriber_range": {"min": 1000, "max": 1000000},
            "upload_frequency_min": "1/week",
            "geo_country": "US",
            "content_type": ["tutorials", "reviews"]
        },
        "search_strategy": {
            "keywords": ["notion productivity tutorial", "best saas tools"],
            "seed_channels": [],
            "competitor_videos": []
        },
        "lead_type": "creator",
        "quota_budget": 2000
    }
    
    agent = YouTubeLeadAgent(quota_budget=payload["quota_budget"])
    result = agent.run(payload)
    
    print("\n--- Test Execution Summary ---")
    staged = result.get("staged_leads", [])
    print(f"[+] Total Staged Leads: {len(staged)}")
    for i, lead in enumerate(staged[:5], 1):
        print(f"\nLead #{i}:")
        print(f"  Name: {lead.get('name')} (@{lead.get('username')})")
        print(f"  Subscribers: {lead.get('subscriber_count')}")
        print(f"  Avg Views: {lead.get('avg_views')}")
        print(f"  Engagement Rate: {lead.get('engagement_rate'):.2%}")
        print(f"  Country: {lead.get('country')}")
        print(f"  Contact Email: {lead.get('email')}")
        print(f"  Website: {lead.get('website')}")
        print(f"  Sponsorship History: {lead.get('sponsorship_history')}")
        print(f"  Reasoning: {lead.get('reasoning')}")

    print("\n[+] YouTube Agent Test Execution Finished Successfully!")

if __name__ == "__main__":
    test_youtube_agent()
