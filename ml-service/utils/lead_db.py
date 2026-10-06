import asyncio
import json
import os
import dotenv
from typing import List, Dict, Any, Optional
from prisma import Prisma
from utils.huggingface_embeddings import generate_embedding

dotenv.load_dotenv()

def build_lead_text_summary(lead: Dict[str, Any]) -> str:
    """Builds a rich textual representation of a lead for embedding generation."""
    username = lead.get("username") or lead.get("handle") or lead.get("custom_url") or lead.get("channel_id") or ""
    bio = lead.get("bio") or lead.get("description") or (lead.get("profile", {}).get("bio") if isinstance(lead.get("profile"), dict) else "") or ""
    creator_info = lead.get("creator_info", "")
    reasoning = lead.get("reasoning", "")
    followers = lead.get("followers") or lead.get("subscriber_count") or 0
    avg_views = lead.get("avg_views", 0)
    engagement_rate = lead.get("engagement_rate", 0)
    sponsorship = lead.get("sponsorship_history") or {}
    posts = lead.get("posts") or lead.get("recent_videos") or []
    
    post_captions = " ".join([
        (p.get("caption") or p.get("title") or p.get("description") or "")[:60]
        for p in posts[:3] if isinstance(p, dict)
    ])
    
    sponsorship_text = f"Sponsorship Rate: {sponsorship.get('sponsorship_rate', 0):.0%}." if sponsorship else ""
    views_text = f"Avg Views: {avg_views}." if avg_views else ""
    
    summary = f"Handle: @{username}. Followers/Subscribers: {followers}. {views_text} Bio/Description: {bio}. Creator Info: {creator_info}. {sponsorship_text} Match Reasoning: {reasoning}. Content Snippets: {post_captions}"
    return summary.strip()

def build_icp_text_summary(icp: Dict[str, Any]) -> str:
    """Builds a text summary of campaign ICP for vector similarity search."""
    industry = icp.get("industry", "")
    target = icp.get("targetProfile", "")
    focus = icp.get("focus", "")
    exclusions = icp.get("exclusions", "")
    return f"Industry: {industry}. Target: {target}. Focus: {focus}. Exclusions: {exclusions}".strip()

async def search_existing_leads_db(icp: Dict[str, Any], target_handles: Optional[List[str]] = None, limit: int = 10, platform: str = "instagram") -> List[Dict[str, Any]]:
    """
    Searches Supabase for existing leads:
    1. Exact handle match (if handles provided).
    2. Vector similarity search against campaign ICP embedding.
    """
    matched_leads = []
    seen_handles = set()
    
    try:
        db = Prisma()
        await db.connect()
        
        # 1. Exact handle matches
        if target_handles:
            clean_handles = [h.replace("@", "").strip().lower() for h in target_handles if h]
            if clean_handles:
                raw_leads = await db.query_raw(
                    "SELECT handle, follower_count, profile, last_scraped_at FROM leads WHERE platform = $1 AND LOWER(handle) = ANY($2::text[]);",
                    platform, clean_handles
                )
                for item in raw_leads:
                    handle = item.get("handle")
                    if handle and handle.lower() not in seen_handles:
                        seen_handles.add(handle.lower())
                        profile_data = item.get("profile") or {}
                        matched_leads.append({
                            "username": handle,
                            "creator_info": profile_data.get("creator_info", "Cached from database"),
                            "reasoning": profile_data.get("reasoning", "Previously verified lead found in database"),
                            "posts": profile_data.get("posts", []),
                            "followers": item.get("follower_count", 0),
                            "found": True,
                            "from_db": True
                        })
                        
        # 2. Vector Similarity Search for ICP if limit not reached
        remaining_slots = limit - len(matched_leads)
        if remaining_slots > 0:
            icp_text = build_icp_text_summary(icp)
            icp_vec = generate_embedding(icp_text)
            vec_str = "[" + ",".join(map(str, icp_vec)) + "]"
            
            vector_query = """
            SELECT handle, follower_count, profile, (embedding <=> $1::vector) AS distance
            FROM leads
            WHERE platform = $2 AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector ASC
            LIMIT $3;
            """
            
            raw_vec_results = await db.query_raw(vector_query, vec_str, platform, remaining_slots * 2)
            
            for item in raw_vec_results:
                handle = item.get("handle")
                distance = item.get("distance", 1.0)
                # Distance threshold for similarity (e.g. < 0.85)
                if handle and handle.lower() not in seen_handles and distance < 0.85:
                    seen_handles.add(handle.lower())
                    profile_data = item.get("profile") or {}
                    matched_leads.append({
                        "username": handle,
                        "creator_info": profile_data.get("creator_info", "Vector match from database"),
                        "reasoning": f"Vector match for campaign ICP (similarity distance: {distance:.2f})",
                        "posts": profile_data.get("posts", []),
                        "followers": item.get("follower_count", 0),
                        "found": True,
                        "from_db": True
                    })
                    if len(matched_leads) >= limit:
                        break

        await db.disconnect()
        print(f"[+] DB Pre-Check ({platform}): Found {len(matched_leads)} cached matching leads in Supabase!")
        return matched_leads

    except Exception as e:
        print(f"[-] Error searching Supabase leads DB: {e}")
        return []

async def save_leads_to_supabase(leads: List[Dict[str, Any]], campaign_id: Optional[str] = None, niche: str = "", platform: str = "instagram"):
    """
    Generates embeddings for validated leads and saves/upserts them into Supabase `leads`
    and `campaign_leads` tables. Now also saves niche[] and geo_country.
    """
    if not leads:
        return
        
    try:
        db = Prisma()
        await db.connect()
        print(f"[*] Generating Hugging Face embeddings and persisting {len(leads)} leads to Supabase ({platform})...")
        
        # Derive niche tags from the niche string
        niche_tags = [tag.strip().lower() for tag in niche.split() if len(tag.strip()) > 2] if niche else []
        
        for lead in leads:
            username = (lead.get("username") or lead.get("handle") or lead.get("channel_id") or "").replace("@", "").strip()
            if not username:
                continue
                
            summary = build_lead_text_summary(lead)
            vec = generate_embedding(summary)
            vec_str = "[" + ",".join(map(str, vec)) + "]"
            
            followers = lead.get("followers") or lead.get("subscriber_count") or 0
            geo_country = lead.get("geo_country") or lead.get("country") or None
            profile_json = json.dumps({
                "name": lead.get("name"),
                "custom_url": lead.get("custom_url"),
                "channel_id": lead.get("channel_id"),
                "creator_info": lead.get("creator_info", ""),
                "reasoning": lead.get("reasoning", ""),
                "posts": lead.get("posts") or lead.get("recent_videos") or [],
                "avg_views": lead.get("avg_views", 0),
                "engagement_rate": lead.get("engagement_rate", 0),
                "sponsorship_history": lead.get("sponsorship_history"),
                "email": lead.get("email"),
                "website": lead.get("website"),
                "intent_type": lead.get("intent_type"),
                "comment": lead.get("comment"),
                "summary": summary
            })
            
            upsert_lead_query = """
            INSERT INTO leads (id, platform, handle, follower_count, engagement_rate, profile, embedding, niche, geo_country, last_scraped_at, last_enriched_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6::vector, $7::text[], $8, NOW(), NOW())
            ON CONFLICT (platform, handle) DO UPDATE SET
                follower_count = EXCLUDED.follower_count,
                engagement_rate = EXCLUDED.engagement_rate,
                profile = EXCLUDED.profile,
                embedding = EXCLUDED.embedding,
                niche = CASE
                    WHEN leads.niche IS NULL OR array_length(leads.niche, 1) IS NULL THEN EXCLUDED.niche
                    ELSE (SELECT array_agg(DISTINCT elem) FROM unnest(leads.niche || EXCLUDED.niche) AS elem)
                END,
                geo_country = COALESCE(EXCLUDED.geo_country, leads.geo_country),
                last_enriched_at = NOW()
            RETURNING id;
            """
            
            engagement = lead.get("engagement_rate") or 0.0
            res = await db.query_raw(upsert_lead_query, platform, username, followers, engagement, profile_json, vec_str, niche_tags, geo_country)
            lead_uuid = res[0]["id"] if res else None
            
            # Connect to campaign_leads if campaign_id is provided
            if campaign_id and lead_uuid:
                try:
                    # Verify campaign exists first to avoid FK violation
                    check_camp = await db.query_raw("SELECT id FROM campaigns WHERE id = $1 LIMIT 1;", campaign_id)
                    if check_camp:
                        upsert_campaign_lead_query = """
                        INSERT INTO campaign_leads (campaign_id, lead_id, icp_score, status)
                        VALUES ($1, $2::uuid, 1.0, 'staged')
                        ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
                            status = 'staged';
                        """
                        await db.execute_raw(upsert_campaign_lead_query, campaign_id, lead_uuid)
                    else:
                        print(f"[!] Campaign '{campaign_id}' not found in DB. Skipping campaign_leads linking.")
                except Exception as fk_err:
                    print(f"[-] FK assignment error for campaign '{campaign_id}': {fk_err}")
                
            print(f"[+] Saved/Updated lead @{username} on {platform} (country={geo_country}, niche={niche_tags}) in Supabase.")
            
        await db.disconnect()
        print("[+] Supabase Lead Persistence Complete!")
        
    except Exception as e:
        print(f"[-] Error saving leads to Supabase: {e}")

async def search_existing_leads_by_niche(icp: Dict[str, Any], niche: str = "", limit: int = 10, geo_target: str = "", platform: str = "instagram", campaign_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Searches Supabase for existing leads using a combined approach:
    1. Niche-based text search (ILIKE on profile content)
    2. Follower count filtering (from ICP minFollowers)
    3. Vector similarity search against ICP embedding
    4. Geo-country filtering (if geoTarget specified and not 'global')
    
    Returns a merged, deduplicated list of matching leads.
    """
    matched_leads = []
    seen_handles = set()
    
    # Exclude leads already linked to this campaign if campaign_id is provided
    already_in_campaign = set()
    if campaign_id:
        try:
            db_temp = Prisma()
            await db_temp.connect()
            existing_cl = await db_temp.query_raw(
                "SELECT l.handle FROM campaign_leads cl JOIN leads l ON cl.lead_id = l.id WHERE cl.campaign_id = $1;",
                campaign_id
            )
            for item in existing_cl:
                if item.get("handle"):
                    already_in_campaign.add(item.get("handle").lower())
            await db_temp.disconnect()
        except Exception as err:
            print(f"[-] Error fetching existing campaign leads: {err}")
    
    # Determine if geo filtering should be applied
    apply_geo_filter = bool(geo_target and geo_target.strip().lower() not in ("", "global", "worldwide", "any"))
    geo_clause = ""
    if apply_geo_filter:
        # Support comma-separated geo targets like "US, UK, India"
        geo_countries = [c.strip() for c in geo_target.split(",") if c.strip()]
        geo_ilike_parts = " OR ".join([f"geo_country ILIKE '%{c}%'" for c in geo_countries])
        geo_clause = f"AND ({geo_ilike_parts})"
        print(f"[+] Applying geo filter: {geo_target}")
    
    try:
        db = Prisma()
        await db.connect()
        
        # Parse min followers from ICP
        min_followers_str = str(icp.get("minFollowers", "0")).lower()
        min_followers = 0
        if "k" in min_followers_str:
            min_followers = int(float(min_followers_str.replace("k", "")) * 1000)
        elif min_followers_str.isdigit():
            min_followers = int(min_followers_str)
        
        # 1. Niche-based text search on profile JSONB content
        if niche:
            niche_keywords = [kw.strip() for kw in niche.split() if len(kw.strip()) > 2]
            if niche_keywords:
                # Build ILIKE conditions for each keyword
                ilike_conditions = " OR ".join([
                    f"profile::text ILIKE '%{kw}%'" for kw in niche_keywords[:5]
                ])
                
                niche_query = f"""
                SELECT handle, follower_count, profile, geo_country
                FROM leads
                WHERE platform = $1
                  AND follower_count >= $2
                  AND ({ilike_conditions})
                  {geo_clause}
                ORDER BY follower_count DESC
                LIMIT $3;
                """
                
                raw_niche_results = await db.query_raw(niche_query, platform, min_followers, limit * 2)
                
                for item in raw_niche_results:
                    handle = item.get("handle")
                    if handle and handle.lower() not in seen_handles and handle.lower() not in already_in_campaign:
                        seen_handles.add(handle.lower())
                        profile_data = item.get("profile") or {}
                        matched_leads.append({
                            "username": handle,
                            "creator_info": profile_data.get("creator_info", "Niche match from database"),
                            "reasoning": f"Matched niche '{niche}' with {item.get('follower_count', 0)} followers",
                            "posts": profile_data.get("posts", []),
                            "followers": item.get("follower_count", 0),
                            "geo_country": item.get("geo_country"),
                            "found": True,
                            "from_db": True
                        })
                
                print(f"[+] Niche text search ({platform}) found {len(matched_leads)} leads")
        
        # 2. Vector similarity search against ICP (if need more)
        remaining_slots = limit - len(matched_leads)
        if remaining_slots > 0:
            icp_text = build_icp_text_summary(icp)
            if niche:
                icp_text = f"Niche: {niche}. {icp_text}"
            
            icp_vec = generate_embedding(icp_text)
            vec_str = "[" + ",".join(map(str, icp_vec)) + "]"
            
            vector_query = f"""
            SELECT handle, follower_count, profile, geo_country, (embedding <=> $1::vector) AS distance
            FROM leads
            WHERE platform = $2 
              AND embedding IS NOT NULL
              AND follower_count >= $3
              {geo_clause}
            ORDER BY embedding <=> $1::vector ASC
            LIMIT $4;
            """
            
            raw_vec_results = await db.query_raw(vector_query, vec_str, platform, min_followers, remaining_slots * 2)
            
            for item in raw_vec_results:
                handle = item.get("handle")
                distance = item.get("distance", 1.0)
                if handle and handle.lower() not in seen_handles and handle.lower() not in already_in_campaign and distance < 0.85:
                    seen_handles.add(handle.lower())
                    profile_data = item.get("profile") or {}
                    matched_leads.append({
                        "username": handle,
                        "creator_info": profile_data.get("creator_info", "Vector match from database"),
                        "reasoning": f"Vector match for ICP (distance: {distance:.2f}), {item.get('follower_count', 0)} followers",
                        "posts": profile_data.get("posts", []),
                        "followers": item.get("follower_count", 0),
                        "geo_country": item.get("geo_country"),
                        "found": True,
                        "from_db": True
                    })
                    if len(matched_leads) >= limit:
                        break
        
        await db.disconnect()
        print(f"[+] DB Niche+Vector Search: Found {len(matched_leads)} matching leads in Supabase!")
        return matched_leads
    
    except Exception as e:
        print(f"[-] Error in niche-based Supabase search: {e}")
        return []

async def save_profiles_to_catalogue(profiles: List[Dict[str, Any]], niche: str = ""):
    """
    Saves raw browser-discovered profiles to the DB catalogue (leads table only).
    No campaign linkage - this is purely for building a massive searchable catalogue
    to avoid slow browser traversal in future runs.
    
    Skips profiles that are already in the DB (ON CONFLICT does lightweight update).
    Now also saves niche[], geo_country, and last_enriched_at.
    """
    if not profiles:
        return
    
    # Derive niche tags
    niche_tags = [tag.strip().lower() for tag in niche.split() if len(tag.strip()) > 2] if niche else []
    
    saved_count = 0
    try:
        db = Prisma()
        await db.connect()
        print(f"[*] Cataloguing {len(profiles)} browser profiles to DB...")
        
        for profile in profiles:
            username = profile.get("username", "").replace("@", "").strip()
            if not username:
                continue
            
            # Build profile summary for embedding
            summary = build_lead_text_summary(profile)
            vec = generate_embedding(summary)
            vec_str = "[" + ",".join(map(str, vec)) + "]"
            
            followers = profile.get("followers") or 0
            bio = profile.get("bio", "")
            geo_country = profile.get("geo_country") or profile.get("country") or None
            profile_json = json.dumps({
                "bio": bio,
                "creator_info": profile.get("creator_info", bio),
                "reasoning": profile.get("reasoning", "Browser-discovered profile"),
                "posts": profile.get("posts", []),
                "summary": summary
            })
            
            upsert_query = """
            INSERT INTO leads (id, platform, handle, follower_count, profile, embedding, niche, geo_country, last_scraped_at, last_enriched_at)
            VALUES (gen_random_uuid(), 'instagram', $1, $2, $3::jsonb, $4::vector, $5::text[], $6, NOW(), NOW())
            ON CONFLICT (platform, handle) DO UPDATE SET
                follower_count = GREATEST(leads.follower_count, EXCLUDED.follower_count),
                profile = CASE 
                    WHEN leads.last_enriched_at IS NULL THEN EXCLUDED.profile
                    ELSE leads.profile
                END,
                embedding = CASE
                    WHEN leads.embedding IS NULL THEN EXCLUDED.embedding
                    ELSE leads.embedding
                END,
                niche = CASE
                    WHEN leads.niche IS NULL OR array_length(leads.niche, 1) IS NULL THEN EXCLUDED.niche
                    ELSE (SELECT array_agg(DISTINCT elem) FROM unnest(leads.niche || EXCLUDED.niche) AS elem)
                END,
                geo_country = COALESCE(EXCLUDED.geo_country, leads.geo_country),
                last_scraped_at = NOW(),
                last_enriched_at = NOW();
            """
            
            await db.execute_raw(upsert_query, username, followers, profile_json, vec_str, niche_tags, geo_country)
            saved_count += 1
        
        await db.disconnect()
        print(f"[+] Catalogued {saved_count} profiles to DB (for future lookups)")
        
    except Exception as e:
        print(f"[-] Error cataloguing profiles to DB: {e}")

# Synchronous wrapper helpers for LangGraph nodes
def search_existing_leads_sync(icp: Dict[str, Any], target_handles: Optional[List[str]] = None, limit: int = 10, platform: str = "instagram") -> List[Dict[str, Any]]:
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(search_existing_leads_db(icp, target_handles, limit, platform))).result()

def search_existing_leads_by_niche_sync(icp: Dict[str, Any], niche: str = "", limit: int = 10, geo_target: str = "", platform: str = "instagram", campaign_id: Optional[str] = None) -> List[Dict[str, Any]]:
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(search_existing_leads_by_niche(icp, niche, limit, geo_target, platform, campaign_id))).result()

def save_leads_to_supabase_sync(leads: List[Dict[str, Any]], campaign_id: Optional[str] = None, niche: str = "", platform: str = "instagram"):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(save_leads_to_supabase(leads, campaign_id, niche, platform))).result()

def save_profiles_to_catalogue_sync(profiles: List[Dict[str, Any]], niche: str = ""):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(save_profiles_to_catalogue(profiles, niche))).result()

async def mark_user_first_job_done(user_id: str):
    if not user_id:
        return
    try:
        db = Prisma()
        await db.connect()
        query = """
        UPDATE users
        SET "firstSuccessfulJobAt" = NOW()
        WHERE id = $1 AND "firstSuccessfulJobAt" IS NULL;
        """
        await db.execute_raw(query, user_id)
        await db.disconnect()
        print(f"[+] Updated firstSuccessfulJobAt for user {user_id}")
    except Exception as e:
        print(f"[-] Error updating firstSuccessfulJobAt for user {user_id}: {e}")

def mark_user_first_job_done_sync(user_id: str):
    if not user_id:
        return
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(mark_user_first_job_done(user_id))).result()

async def update_campaign_status(campaign_id: str, status: str):
    if not campaign_id:
        return
    try:
        db = Prisma()
        await db.connect()
        query = """
        UPDATE campaigns
        SET status = $1, "updatedAt" = NOW()
        WHERE id = $2;
        """
        await db.execute_raw(query, status, campaign_id)
        await db.disconnect()
        print(f"[+] Updated campaign '{campaign_id}' status to '{status}' in DB.")
    except Exception as e:
        print(f"[-] Error updating campaign '{campaign_id}' status to '{status}': {e}")

def update_campaign_status_sync(campaign_id: str, status: str):
    if not campaign_id:
        return
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(update_campaign_status(campaign_id, status))).result()


