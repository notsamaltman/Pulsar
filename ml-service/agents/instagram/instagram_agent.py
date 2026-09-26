import random
import time
import json
import os
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from deepagents import create_deep_agent
from typing import Dict, Any, List, Optional, Set
import sys
import threading
import json
import os
from pydantic import BaseModel, Field
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END
from typing import TypedDict, List, Dict, Any, Optional, Set
import operator

# --- Add parent path to import utils ---
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from utils.lead_db import search_existing_leads_sync, save_leads_to_supabase_sync, search_existing_leads_by_niche_sync, save_profiles_to_catalogue_sync
from utils.llm import get_groq_llm

# --- Global Storage for Intercepted Data ---
INTERCEPTED_DATA = []
STAGED_LEADS = []
SEARCHED_USERNAMES: Set[str] = set()

page = None
browser_context = None
playwright_instance = None

_thread_local = threading.local()
_main_thread_id = None
BROWSER_LOCK = threading.Lock()

# --- LangGraph State Definition ---
class InstagramAgentState(TypedDict):
    campaign_id: Optional[str] # Campaign UUID for Supabase linkage
    icp: Dict[str, Any] # Contains campaign inputs: industry, targetProfile, focus, etc.
    niche: str # Derived from ICP - used for DB search and hashtag generation
    item_profile: Dict[str, Any]
    hashtags: List[str]
    discovered_posts: List[Dict[str, Any]] # Raw posts from hashtags
    usernames_to_enrich: List[str]
    profiles_data: List[Dict[str, Any]] # Full bio + metrics
    staged_leads: List[Dict[str, Any]] # LLM-validated campaign leads (pushed via BullMQ)
    catalogue_profiles: List[Dict[str, Any]] # ALL browser profiles (saved to DB for catalogue)
    db_leads: List[Dict[str, Any]] # Leads from DB pre-check (before LLM filter)
    needs_browser_search: bool # Whether we need to fall back to browser
    target_lead_count: int # How many leads we're aiming for
    error: Optional[str]


def _get_page():
    """Returns a thread-safe page object. Uses CDP connection if in a child thread."""
    global page, _main_thread_id
    
    # Check thread-local storage first
    if hasattr(_thread_local, "page") and _thread_local.page:
        try:
            _thread_local.page.url
            return _thread_local.page
        except Exception:
            _thread_local.page = None

    # Main thread can use the global handle
    if threading.get_ident() == _main_thread_id:
        if page:
            try:
                page.url
                _thread_local.page = page
                return page
            except Exception:
                pass

    # All other threads (or main thread if global is missing) connect via CDP
    try:
        from playwright.sync_api import sync_playwright
        if not hasattr(_thread_local, "playwright") or not _thread_local.playwright:
            _thread_local.playwright = sync_playwright().start()
        
        browser = _thread_local.playwright.chromium.connect_over_cdp("http://localhost:9222", timeout=10000)
        _thread_local.browser = browser
        
        if browser.contexts:
            ctx = browser.contexts[0]
            if ctx.pages:
                _thread_local.page = ctx.pages[0]
            else:
                _thread_local.page = ctx.new_page()
        else:
            ctx = browser.new_context()
            _thread_local.page = ctx.new_page()
            
        return _thread_local.page
    except Exception as e:
        print(f"[-] Thread {threading.get_ident()} failed to connect via CDP: {e}")
        if page:
            try:
                page.url
                return page
            except Exception:
                pass
        raise e

def _get_context():
    """Returns a thread-safe browser context."""
    global browser_context
    if hasattr(_thread_local, "context") and _thread_local.context:
        return _thread_local.context
    _get_page()
    return getattr(_thread_local, "context", browser_context)

parent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(parent_dir)
load_dotenv()

# --- Existing Helper Functions ---
script_dir = Path(__file__).parent
context_path = script_dir / "instagram_context.json"
session_path = script_dir / "session.json"

with open(context_path, 'r') as file:
    context = json.load(file)

def parse_xdt_media(items: List[Dict[Any, Any]]):
    """Parses XDTMediaDict objects from Instagram's response."""
    extracted = []
    for item in items:
        try:
            pk = item.get("pk")
            code = item.get("code")
            user = item.get("user", {})
            username = user.get("username")
            full_name = user.get("full_name")
            
            caption_data = item.get("caption") or {}
            caption_text = caption_data.get("text", "")
            
            like_count = item.get("like_count", 0)
            comment_count = item.get("comment_count", 0)
            
            # Find best image/video URL
            image_versions = item.get("image_versions2", {}).get("candidates", [])
            media_url = image_versions[0].get("url") if image_versions else None
            
            extracted.append({
                "id": pk,
                "shortcode": code,
                "url": f"https://www.instagram.com/p/{code}/" if code else None,
                "username": username,
                "full_name": full_name,
                "caption": caption_text,
                "likes": like_count,
                "comments": comment_count,
                "media_url": media_url,
                "timestamp": item.get("taken_at")
            })
        except Exception as e:
            print(f"[-] Error parsing media item: {e}")
            continue
    return extracted

class Lead(BaseModel):
    """Pydantic model for validating lead data."""
    username: str = Field(..., description="The creator's handle.")
    creator_info: str = Field(..., description="Short description of who they are and what they do.")
    reasoning: str = Field(..., description="Detailed reasoning why they match the ICP and product.")
    posts: List[Dict[str, Any]] = Field(..., description="Array of recent posts with url and media_url.")
    found: bool = Field(True, description="Whether the profile was successfully analyzed.")

def push_staged_leads_tool(leads: List[Dict[str, Any]]):
    """
    Pushes a list of analyzed leads to the global staging area.
    This should be called after you have investigated profiles using search_profile()
    and verified that they match the ICP.
    
    Args:
        leads (List[Dict]): A list of lead objects matching the Lead schema.
    """
    global STAGED_LEADS
    count = 0
    for lead_data in leads:
        try:
            # Validate using Pydantic
            lead = Lead(**lead_data)
            # Avoid duplicates in staged leads
            if not any(l['username'] == lead.username for l in STAGED_LEADS):
                STAGED_LEADS.append(lead.model_dump())
                print(f"[+] Lead @{lead.username} pushed to staged leads.")
                count += 1
        except Exception as e:
            print(f"[-] Failed to validate lead data for @{lead_data.get('username', 'unknown')}: {e}")
    
    return f"Successfully pushed {count} leads."

def parse_xdt_user(data: Dict[Any, Any]):
    """Parses user/profile information from Instagram's response."""
    try:
        # Check standard XDT/GraphQL patterns
        user = data.get("user") or data
        
        # If it's a GraphQL user object (with edges)
        follower_count = user.get("follower_count")
        if follower_count is None:
            follower_count = user.get("edge_followed_by", {}).get("count")
            
        following_count = user.get("following_count")
        if following_count is None:
            following_count = user.get("edge_follow", {}).get("count")
            
        post_count = user.get("media_count")
        if post_count is None:
            post_count = user.get("edge_owner_to_timeline_media", {}).get("count")
            
        return {
            "type": "profile",
            "username": user.get("username"),
            "full_name": user.get("full_name"),
            "followers": follower_count,
            "following": following_count,
            "posts": post_count,
            "is_private": user.get("is_private"),
            "is_verified": user.get("is_verified"),
            "biography": user.get("biography"),
            "external_url": user.get("external_url"),
            "id": user.get("pk") or user.get("id")
        }
    except Exception as e:
        print(f"[-] Error parsing user item: {e}")
        return None

def recursive_find_media(data, found_items, found_users=None):
    """Recursively searches for XDTMediaDict or items that look like media/users."""
    if found_users is None:
        found_users = []
        
    if isinstance(data, dict):
        # Check if this dict is a user profile
        if data.get("__typename") == "User" or (data.get("pk") and data.get("username") and "follower_count" in data):
            found_users.append(data)
            # We don't necessarily return early here because users can contain media items

        # Check if this dict itself is a media item
        if data.get("__typename") == "XDTMediaDict" or (data.get("pk") and data.get("code") and "user" in data):
            found_items.append(data)
            return

        # Check for "items" or "edges"
        if "items" in data and isinstance(data["items"], list):
            for item in data["items"]:
                recursive_find_media(item, found_items, found_users)
        if "edges" in data and isinstance(data["edges"], list):
            for edge in data["edges"]:
                node = edge.get("node")
                if node:
                    # Special handling for standard GraphQL nodes
                    if node.get("__typename") == "GraphImage" or node.get("__typename") == "GraphVideo" or node.get("__typename") == "GraphSidecar":
                        # Convert node to a common format or just store it
                        INTERCEPTED_DATA.append({
                            "type": "post",
                            "id": node.get("id"),
                            "shortcode": node.get("shortcode"),
                            "url": f"https://www.instagram.com/p/{node.get('shortcode')}/",
                            "username": node.get("owner", {}).get("username"),
                            "caption": node.get("edge_media_to_caption", {}).get("edges", [{}])[0].get("node", {}).get("text", "") if node.get("edge_media_to_caption") else "",
                            "likes": node.get("edge_liked_by", {}).get("count") if node.get("edge_liked_by") else 0,
                            "comments": node.get("edge_media_to_comment", {}).get("count") if node.get("edge_media_to_comment") else 0,
                            "media_url": node.get("display_url"),
                            "timestamp": node.get("taken_at_timestamp")
                        })
                    else:
                        recursive_find_media(node, found_items, found_users)
        
        # Recurse into all values
        for key, value in data.items():
            if isinstance(value, (dict, list)):
                # If we're entering a user object, we might want to capture it
                if key == "user" and isinstance(value, dict):
                    found_users.append(value)
                recursive_find_media(value, found_items, found_users)
                
    elif isinstance(data, list):
        for item in data:
            recursive_find_media(item, found_items, found_users)

def handle_response(response):
    if response.status == 200:
        url = response.url
        # Ignore common non-data assets
        if any(ext in url for ext in [".jpg", ".png", ".webp", ".mp4", ".woff", ".css", ".js"]):
            return

        try:
            # Check if this is a GraphQL response that might contain profile info
            is_profile_query = False
            try:
                post_data = response.request.post_data
                if post_data and "web_profile_info" in post_data:
                    is_profile_query = True
            except:
                pass

            # Try to parse as JSON regardless of content-type for robustness
            data = response.json()

            # Specific check for web_profile_info as suggested by user
            if is_profile_query:
                user_data = data.get("data", {}).get("user")
                if user_data:
                    parsed_user = parse_xdt_user(user_data)
                    if parsed_user and parsed_user.get("username"):
                        if not any(d.get("type") == "profile" and d.get("username") == parsed_user["username"] for d in INTERCEPTED_DATA):
                            print(f"[+] Intercepted profile info for {parsed_user['username']} via web_profile_info...")
                            INTERCEPTED_DATA.append(parsed_user)
                            # Do NOT return here, we want to extract posts too

            found_xdt_items = []
            found_users = []
            recursive_find_media(data, found_xdt_items, found_users)
            
            if found_users:
                for user_data in found_users:
                    parsed_user = parse_xdt_user(user_data)
                    if parsed_user and parsed_user.get("username"):
                        # Check if we already have this user
                        if not any(d.get("type") == "profile" and d.get("username") == parsed_user["username"] for d in INTERCEPTED_DATA):
                            print(f"[+] Intercepted profile info for {parsed_user['username']}...")
                            INTERCEPTED_DATA.append(parsed_user)

            if found_xdt_items:
                parsed = parse_xdt_media(found_xdt_items)
                if parsed:
                    print(f"[+] Intercepted {len(parsed)} posts via recursive search...")
                    for p in parsed:
                        p["type"] = "post"
                    INTERCEPTED_DATA.extend(parsed)

        except Exception as e:
            # print(f"Error in handle_response: {e}")
            pass

def human_type(selector, text):
    """Types text like a human with random delays between keystrokes."""
    page = _get_page()
    page.click(selector)
    for char in text:
        page.keyboard.type(char, delay=random.randint(50, 150))
        if random.random() > 0.9:
            time.sleep(random.uniform(0.1, 0.3))

def save_session(username):
    """Saves the current browser state (cookies, local storage) and metadata."""
    context = _get_context()
    storage_state = context.storage_state()
    session_data = {
        "username": username,
        "last_login": datetime.now().isoformat(),
        "storage_state": storage_state
    }
    with open(session_path, 'w') as f:
        json.dump(session_data, f, indent=4)
    print(f"[+] Session saved for {username} at {session_data['last_login']}")

def load_session():
    """Loads the stored session data if it exists."""
    if session_path.exists():
        with open(session_path, 'r') as f:
            return json.load(f)
    return None

def is_logged_in():
    """Checks if the user is currently logged in by looking for common home elements or interstitials."""
    page = _get_page()
    try:
        # Check if we are redirected to the feed or if the login button is absent
        page.wait_for_load_state("networkidle", timeout=5000)
        # If the search icon or profile icon is visible, we are likely logged in
        # These selectors should be in the context, but let's use a general check
        selectors = ["svg[aria-label='Home']", "svg[aria-label='New post']", "img[alt*='profile picture']"]
        for selector in selectors:
            if page.query_selector(selector):
                return True
        
        # Check for interstitials (which also mean login was successful)
        interstitials = context.get('selectors', {}).get('interstitials', {})
        interstitial_selectors = [
            interstitials.get('save_info_page'),
            interstitials.get('notifications_page')
        ]
        for selector in interstitial_selectors:
            if selector and page.query_selector(selector):
                return True

        return False
    except:
        return False

def detect_challenge():
    """
    Checks the page for common Instagram challenges, reCAPTCHA, 
    or suspicious activity warnings.
    """
    page = _get_page()
    challenge_indicators = [
        "iframe[title*='reCAPTCHA']",
        "iframe[src*='recaptcha']",
        "text='Suspicious Login Attempt'",
        "text='Help Us Confirm You Own This Account'",
        "text='Confirm Your Details to Get Back Into Your Account'",
        "text='Challenge'",
        "div:has-text('Add a Phone Number to Get Back Into Instagram')",
        "button:has-text('Verify')"
    ]
    
    for indicator in challenge_indicators:
        try:
            if page.query_selector(indicator):
                print(f"[!] Challenge detected: Found indicator '{indicator}'")
                return True
        except:
            continue
    return False

def detect_login_errors():
    """
    Checks the page for login-specific errors like incorrect password
    or account not found.
    """
    page = _get_page()
    error_selectors = [
        "#slfErrorAlert",
        "p[aria-atomic='true'][role='alert']",
        "div:has-text('incorrect')",
        "div:has-text('double-check your password')",
        "div:has-text('username you entered doesn\\'t belong to an account')"
    ]
    for selector in error_selectors:
        try:
            if page.query_selector(selector):
                error_text = page.inner_text(selector)
                print(f"[-] Login Error Detected: {error_text}")
                return True
        except:
            continue
    return False

def handle_email_verification(context):
    page = _get_page()
    print("Checking for email verification screen...")
    
    code_input_selector = context['selectors']['security']['code_input']
    continue_btn_selector = context['selectors']['security']['continue_button']

    try:
        page.wait_for_selector(code_input_selector, state="visible", timeout=10000)
        print("\n[!] Email verification detected.")
        verification_code = input(">>> Enter the 6-digit code sent to your email: ")
        human_type(code_input_selector, verification_code)
        page.click(continue_btn_selector)
        print("[+] Code submitted! Waiting for dashboard...")
        page.wait_for_load_state("networkidle")
    except Exception:
        print("[+] No verification screen found, proceeding.")

def handle_post_login_interstitials(context):
    """Handles and skips post-login interstitials like 'Save Info' and 'Notifications'."""
    page = _get_page()
    print("Checking for post-login interstitials...")
    interstitials = context.get('selectors', {}).get('interstitials', {})
    
    # Handle "Save Login Info"
    save_info_selector = interstitials.get('save_info_page')
    not_now_save_selector = interstitials.get('save_info_not_now')
    
    if save_info_selector and page.query_selector(save_info_selector):
        print("[+] 'Save Login Info' detected. Clicking 'Not now'...")
        page.click(not_now_save_selector)
        time.sleep(random.randint(2, 4))
        page.wait_for_load_state("networkidle")

    # Handle "Turn on Notifications"
    notifications_selector = interstitials.get('notifications_page')
    not_now_notif_selector = interstitials.get('notifications_not_now')
    
    if notifications_selector and page.query_selector(notifications_selector):
        print("[+] 'Turn on Notifications' detected. Clicking 'Not now'...")
        page.click(not_now_notif_selector)
        time.sleep(random.randint(2, 4))
        page.wait_for_load_state("networkidle")

def login_and_save(email, password):
    """Performs the full login flow and saves the session."""
    page = _get_page()
    page.goto("https://www.instagram.com")
    time.sleep(random.randint(3, 6))

    # Initial check for any existing challenges (e.g., suspicious IP)
    if detect_challenge():
        print("\n" + "!"*50)
        print("ACTION REQUIRED: A challenge/reCAPTCHA was detected before login.")
        print("Please solve it in the browser window and then press Enter here.")
        print("!"*50)
        input(">>> Press Enter after solving the challenge...")

    # Check if we are already on the login page
    if page.query_selector(context['selectors']['login']['username_input']):
        print(f"Logging in as {email}...")
        human_type(context['selectors']['login']['username_input'], email)
        human_type(context['selectors']['login']['password_input'], password)
        time.sleep(random.randint(1, 3))
        page.click(context['selectors']['login']['login_button'])

        # Wait and check for errors or challenges
        time.sleep(5)
        if detect_login_errors():
            print("[-] Login failed due to incorrect credentials.")
            return False

        if detect_challenge():
            print("\n" + "!"*50)
            print("ACTION REQUIRED: reCAPTCHA or Challenge detected after login.")
            print("Please solve it in the browser window and then press Enter here.")
            print("!"*50)
            input(">>> Press Enter after solving the challenge...")

        handle_email_verification(context)
        
        # Wait for login to complete and handle interstitials
        page.wait_for_load_state("networkidle")
        handle_post_login_interstitials(context)
        
    if is_logged_in():
        # Extract username if possible from the UI or just use the email prefix
        username = email.split('@')[0] 
        save_session(username)
        return True
    return False

def search_hashtag(hashtag: str):
    """
    Searches for a hashtag on Instagram and extracts details of all loaded posts.

    CRITICAL: ALWAYS START HERE. Use this to find new users from a hashtag.
    Input MUST be a single word keyword (e.g. 'lifestyle').
    DO NOT pass usernames here.
    
    Returns:
        dict: A dictionary containing:
            ...
            - method (str): "graphql" or "dom_scraping".
    """
    with BROWSER_LOCK:
        page = _get_page()
        page.on("response", handle_response) # RE-ATTACH for this thread
        global INTERCEPTED_DATA
        INTERCEPTED_DATA = [] # Clear previous results
    
    print(f"Searching for hashtag: #{hashtag}")
    # revert to explore/tags with domcontentloaded wait_until and timeout protection
    try:
        page.goto(f"https://www.instagram.com/explore/tags/{hashtag}/", wait_until="domcontentloaded", timeout=20000)
    except Exception as goto_err:
        print(f"[!] Warning: page.goto for #{hashtag} timed out or threw warning: {goto_err}. Continuing with DOM/interception...")

    try:
        # Wait for initial load
        post_item_selector = context['selectors']['navigation'].get('search_results_item', "a[href*='/p/'], a[href*='/reel/']")
        page.wait_for_selector(post_item_selector, timeout=15000)
        
        # Scroll down a bit to trigger more data requests
        print("[+] Scrolling to load more content...")
        for _ in range(5): # Increase scrolls
            page.mouse.wheel(0, 2000) # Use mouse.wheel as in the working script
            time.sleep(random.uniform(1.0, 2.0))
        
        # Give it a few seconds to trigger more network requests
        print("[+] Waiting for network interception to complete...")
        time.sleep(3) 
        
        # Deduplicate intercepted data by ID or URL
        unique_posts = {}
        for post in INTERCEPTED_DATA:
            identifier = post.get("id") or post.get("shortcode") or post.get("url")
            if identifier and identifier not in unique_posts:
                unique_posts[identifier] = post
        
        captured_list = list(unique_posts.values())
        print(f"[+] Successfully intercepted {len(captured_list)} unique posts via GraphQL.")

        # Fallback to DOM scraping if no network data was captured
        if not captured_list:
            print("[!] No GraphQL data intercepted. Falling back to DOM scraping...")
            posts = []
            post_elements = page.query_selector_all(post_item_selector)
            for element in post_elements:
                try:
                    href = element.get_attribute("href")
                    if not href: continue
                    full_url = f"https://www.instagram.com{href}" if href.startswith("/") else href
                    img = element.query_selector("img")
                    caption = img.get_attribute("alt") if img else "No caption found"
                    all_text = element.text_content().strip().replace('\n', ' ')
                    posts.append({
                        "url": full_url,
                        "caption": caption,
                        "metrics_text": all_text,
                        "is_scraped": True
                    })
                except: continue
            captured_list = posts

        return {
            "hashtag": hashtag,
            "post_count": len(captured_list),
            "posts": captured_list,
            "method": "graphql" if INTERCEPTED_DATA else "dom_scraping"
        }
        
    except Exception as e:
        print(f"[-] Error during hashtag search: {e}")
        return {"error": str(e), "hashtag": hashtag}

def search_profile(usernames: List[str]):
    """
    Navigates to the profile pages of the given usernames one by one 
    and returns the profile info and the first 5 posts for each.

    STRICTLY FOR VALIDATION ONLY. Use this ONLY after you have extracted 
    usernames from 'search_hashtag'. 
    NEVER use this with general keywords like 'lifestyle' or 'entrepreneur'.
    
    Args:
        usernames (List[str]): A list of Instagram usernames to search.
        
    Returns:
        List[Dict]: A list of results, each containing profile info and recent posts.
    """
    with BROWSER_LOCK:
        page = _get_page()
        page.on("response", handle_response) # RE-ATTACH for this thread
        global INTERCEPTED_DATA
        results = []
    
        for i, username in enumerate(usernames):
            username = username.strip().replace("@", "")
            
            if username in SEARCHED_USERNAMES:
                print(f"[i] Skipping already searched profile: @{username}")
                continue
                
            # Add random delay between profiles to avoid detection (except first)
            if i > 0:
                delay = random.uniform(4.0, 10.0)
                print(f"[*] Sleeping for {delay:.2f}s before next profile...")
                time.sleep(delay)

            print(f"[+] Navigating to profile: @{username}")
            INTERCEPTED_DATA = [] # Clear for each user 
            try:
                try:
                    page.goto(f"https://www.instagram.com/{username}/", wait_until="domcontentloaded", timeout=20000)
                except Exception as goto_err:
                    print(f"[!] Warning: page.goto for @{username} timed out or threw warning ({goto_err}). Continuing...")
                
                # Wait for data to be intercepted
                print(f"[+] Waiting for @{username} data...")
                max_wait = 15
                start_time = time.time()
                while time.time() - start_time < max_wait:
                    has_profile = any(d.get("type") == "profile" and d.get("username").lower() == username.lower() for d in INTERCEPTED_DATA)
                    has_posts = any(d.get("type") == "post" for d in INTERCEPTED_DATA)
                    if has_profile and has_posts:
                        break
                    page.wait_for_timeout(1000)
                    
                # Extract and filter
                profile = next((d for d in INTERCEPTED_DATA if d.get("type") == "profile" and d.get("username").lower() == username.lower()), None)
                # CRITICAL: Only take posts that belong to the searched username
                posts = [d for d in INTERCEPTED_DATA if d.get("type") == "post" and d.get("username", "").lower() == username.lower()][:5]
                
                results.append({
                    "username": username,
                    "profile": profile,
                    "posts": posts,
                    "found": profile is not None
                })
                print(f"[+] Captured data for @{username}")
                
            except Exception as e:
                print(f"[-] Error searching profile @{username}: {e}")
                results.append({"username": username, "error": str(e), "found": False})
            
            # Record as searched
            SEARCHED_USERNAMES.add(username)
            
    return results

def launch_browser():
    """
    Launches browser and automatically completes authentication + session saving
    and navigates to instagram
    """
    with BROWSER_LOCK:
        global page, browser_context, playwright_instance, _main_thread_id
        _main_thread_id = threading.get_ident() # Store current thread id
        email = os.getenv("INSTAGRAM_EMAIL")
        password = os.getenv("INSTAGRAM_PASSWORD")

        if not email or not password:
            print("Error: INSTAGRAM_EMAIL and INSTAGRAM_PASSWORD env variables must be set.")
            return

        # Stop existing playwright instance if initialized from a dead thread
        if playwright_instance is not None:
            try:
                playwright_instance.stop()
            except Exception:
                pass
            playwright_instance = None

        from playwright.sync_api import sync_playwright
        try:
            playwright_instance = sync_playwright().start()
            browser = playwright_instance.chromium.launch(
                channel="chrome",
                headless=False,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--remote-debugging-port=9222"],
            )
        except Exception as e:
            print(f"[-] Initial playwright launch attempt failed ({e}). Retrying fresh instance...")
            playwright_instance = sync_playwright().start()
            browser = playwright_instance.chromium.launch(
                channel="chrome",
                headless=False,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--remote-debugging-port=9222"],
            )
    
    session_data = load_session()
    storage_state = session_data.get("storage_state") if session_data else None

    # Use new_context to correctly handle storage_state
    browser_context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        storage_state=storage_state
    )
    
    page = browser_context.pages[0] if browser_context.pages else browser_context.new_page()
    try:
        page.goto("https://www.instagram.com", wait_until="domcontentloaded", timeout=20000)
    except Exception as goto_err:
        print(f"[!] Warning: page.goto instagram home took longer than 20s ({goto_err}). Continuing...")
    page.on("response", handle_response)

    print("Checking session validity...")
    if is_logged_in():
        print(f"[+] Valid session found for {session_data.get('username')}. Reusing...")
    else:
        print("[!] Session expired or not found. Logging in...")
        if not login_and_save(email, password):
            print("[-] Login failed.")
        else:
            print("[+] Login successful and session saved.")

    print("\n[+] Browser launch and authentication complete.")

    # --- Inject Visual Effects and Lock ---
    inject_visual_effects(page)

def inject_visual_effects(page):
    """Injects a lock overlay, glare effects, and a thinking indicator into the page."""
    css = """
    #pulsar-lock-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483647;
        pointer-events: auto;
        background: transparent;
        border: 4px solid transparent;
        box-sizing: border-box;
        transition: border 0.5s ease;
    }
    #pulsar-lock-overlay.active {
        border: 4px solid rgba(0, 191, 255, 0.2);
    }
    .pulsar-glare {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: 
            radial-gradient(circle at 0% 0%, rgba(138, 43, 226, 0.1) 0%, transparent 35%),
            radial-gradient(circle at 100% 0%, rgba(0, 191, 255, 0.1) 0%, transparent 35%),
            radial-gradient(circle at 100% 100%, rgba(138, 43, 226, 0.1) 0%, transparent 35%),
            radial-gradient(circle at 0% 100%, rgba(0, 191, 255, 0.1) 0%, transparent 35%);
        pointer-events: none;
        z-index: 2147483646;
    }
    #pulsar-thinking {
        position: fixed;
        bottom: 30px;
        left: 30px;
        display: flex;
        align-items: center;
        gap: 15px;
        background: rgba(15, 15, 15, 0.85);
        padding: 12px 24px;
        border-radius: 50px;
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #e0e0e0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        font-weight: 500;
        z-index: 2147483647;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        letter-spacing: 0.5px;
    }
    .pulsar-loader {
        width: 22px;
        height: 22px;
        border: 2px solid rgba(0, 191, 255, 0.1);
        border-top: 2px solid #00BFFF;
        border-radius: 50%;
        animation: pulsar-spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes pulsar-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    """
    
    html = """
    <div id="pulsar-lock-overlay"></div>
    <div class="pulsar-glare"></div>
    <div id="pulsar-thinking">
        <div class="pulsar-loader"></div>
        <span>Agent is thinking...</span>
    </div>
    """
    
    script = f"""
    (function() {{
        if (document.getElementById('pulsar-lock-overlay')) return;
        const style = document.createElement('style');
        style.textContent = `{css}`;
        document.head.appendChild(style);
        
        const container = document.createElement('div');
        container.innerHTML = `{html}`;
        document.body.appendChild(container);
        
        // Add visual pulse to lock overlay
        const lock = document.getElementById('pulsar-lock-overlay');
        setInterval(() => {{
            lock.classList.toggle('active');
        }}, 2000);
    }})();
    """
    try:
        page.evaluate(script)
        print("[+] Visual effects and browser lock injected successfully.")
    except Exception as e:
        print(f"[-] Failed to inject visual effects: {e}")

def sleep(seconds: int):
    """
    sleep for a defined amount of time
    """
    time.sleep(seconds)

def get_instagram_llm():
    try:
        return get_groq_llm(temperature=0.0)
    except Exception as e:
        print(f"[-] Instagram LLM initialization error: {e}")
        return None

def invoke_llm_with_retry(prompt: str, max_retries: int = 3) -> Optional[Dict[str, Any]]:
    """Invokes LLM with retries and robust JSON extraction."""
    llm_inst = get_instagram_llm()
    if not llm_inst:
        return None
    for i in range(max_retries):
        try:
            # Add a small delay between retries
            if i > 0:
                time.sleep(random.uniform(1.0, 3.0))
                
            response = llm_inst.invoke(prompt)
            content = response.content.strip() if hasattr(response, 'content') else str(response).strip()
            
            if not content:
                print(f"[-] Attempt {i+1}: Received empty response from LLM.")
                continue

            # Robust JSON extraction
            if "{" in content and "}" in content:
                json_str = content[content.find("{"):content.rfind("}")+1]
                data = json.loads(json_str)
                return data
            else:
                # Try to clean common LLM garbage
                cleaned = content.replace("```json", "").replace("```", "").strip()
                return json.loads(cleaned)
        except Exception as e:
            print(f"[-] Attempt {i+1} failed ({type(e).__name__}): {e}")
            if i == max_retries - 1:
                return None
    return None

def push_leads(leads: List[Dict[str, Any]], campaign_id: Optional[str] = None, niche: str = ""):
    """Pushes staged leads to global memory and persists to Supabase with vector embeddings."""
    global STAGED_LEADS
    for lead in leads:
        if lead not in STAGED_LEADS:
            STAGED_LEADS.append(lead)
    save_leads_to_supabase_sync(leads, campaign_id, niche)

# --- LangGraph Nodes ---

def derive_niche_node(state: InstagramAgentState):
    """Derives the niche from ICP for use as Instagram agent's niche."""
    print("\n--- [Node] Deriving Niche from ICP ---")
    icp = state.get('icp', {})
    target_count = icp.get("target_lead_count", 10)
    campaign_id = state.get("campaign_id") or icp.get("campaignId") or icp.get("campaign_id")
    
    # Build niche string from ICP fields
    industry = icp.get("industry", "")
    target_profile = icp.get("targetProfile", "")
    focus = icp.get("focus", "")
    niche = f"{industry} {target_profile} {focus}".strip()
    if not niche:
        niche = "lifestyle"
    
    print(f"[+] Agent niche set to: '{niche}' | Campaign ID: {campaign_id}")
    return {"niche": niche, "target_lead_count": target_count, "campaign_id": campaign_id}

def db_search_node(state: InstagramAgentState):
    """
    Searches Supabase database for existing leads using:
    1. Niche-based text matching
    2. Follower count filtering  
    3. Vector similarity search against ICP
    4. Geo-country filtering (if geoTarget is set and not 'global')
    Results are stored for LLM filtering (not directly staged).
    """
    print("\n--- [Node] DB Search (Niche + Followers + Vector + Geo) ---")
    icp = state.get('icp', {})
    niche = state.get('niche', '')
    target_count = state.get('target_lead_count', 10)
    geo_target = icp.get('geoTarget', '')
    campaign_id = state.get("campaign_id") or icp.get("campaignId") or icp.get("campaign_id")
    
    # Search with a higher limit so LLM can filter down
    search_limit = target_count * 3
    cached_leads = search_existing_leads_by_niche_sync(icp, niche=niche, limit=search_limit, geo_target=geo_target, campaign_id=campaign_id)
    
    if cached_leads:
        for lead in cached_leads:
            username = lead.get("username")
            if username:
                SEARCHED_USERNAMES.add(username.lower())
        print(f"[+] Found {len(cached_leads)} potential leads from DB (niche + vector + geo search)")
        return {"db_leads": cached_leads}
    else:
        print("[i] No matching leads found in database.")
    return {"db_leads": []}

def llm_filter_db_leads_node(state: InstagramAgentState):
    """
    Uses LLM to filter DB-sourced leads - picks the best matches from cached results.
    Also estimates country from creator name/username for geo filtering.
    Determines if browser search is needed based on how many leads pass.
    
    Sends all candidates in a single call since Llama 3.1 8B has 128K context.
    """
    print("\n--- [Node] LLM Filter on DB Leads ---")
    icp = state.get('icp', {})
    niche = state.get('niche', '')
    db_leads = state.get('db_leads', [])
    target_count = state.get('target_lead_count', 10)
    geo_target = icp.get('geoTarget', '')
    
    if not db_leads:
        print("[i] No DB leads to filter. Browser search will be needed.")
        return {"staged_leads": [], "needs_browser_search": True}
    
    # Prepare rich candidate data - include everything we have since context is huge
    candidates = []
    for lead in db_leads:
        posts = lead.get("posts", [])
        post_summaries = [{"caption": p.get("caption", "")[:100], "likes": p.get("likes", 0)} for p in posts[:3]] if isinstance(posts, list) else []
        candidates.append({
            "username": lead.get("username", ""),
            "creator_info": lead.get("creator_info", ""),
            "followers": lead.get("followers", 0),
            "reasoning": lead.get("reasoning", ""),
            "geo_country": lead.get("geo_country", ""),
            "posts": post_summaries
        })
    
    # Build geo instruction for the prompt
    geo_instruction = ""
    if geo_target and geo_target.strip().lower() not in ("", "global", "worldwide", "any"):
        geo_instruction = f"""\n\nGEO TARGETING (IMPORTANT):
- Target geography: {geo_target}
- For each selected lead, estimate their likely country based on their username, full name, bio language, and content context.
- ONLY select leads who are likely based in or relevant to: {geo_target}
- If a lead's geo_country is already set, use that. Otherwise, estimate from their name/username."""
    else:
        geo_instruction = """\n\nCOUNTRY ESTIMATION:
- For each selected lead, estimate their likely country based on their username, full name, bio language, and content context.
- Use your best judgment from naming patterns (e.g., "raj_sharma" -> India, "john_smith" -> US/UK, "tanaka_yuki" -> Japan)."""
    
    prompt = f"""You are a lead qualification expert for an Instagram outreach campaign.

Campaign Target Settings:
- Industry: {icp.get('industry')}
- Niche: {niche}
- Target Profile: {icp.get('targetProfile')}
- Focus: {icp.get('focus')}
- Exclusions: {icp.get('exclusions')}
- Content Type: {icp.get('contentType', 'any')}

Item being sold: {state.get('item_profile', {}).get('item_to_sell', 'N/A')}
Target audience: {state.get('item_profile', {}).get('target_audience', 'N/A')}
{geo_instruction}

From these {len(candidates)} cached leads from our database, select the BEST matches for this campaign.
Be selective - only pick leads that are a strong fit for the item being sold and target audience.

Candidates:
{json.dumps(candidates)}

Respond ONLY with a JSON object: {{"selected": [{{"username": "handle1", "estimated_country": "Country Name"}}, ...]}}"""

    data = invoke_llm_with_retry(prompt)
    
    selected_leads = []
    if data and "selected" in data:
        # Handle both old format (list of strings) and new format (list of objects)
        selected_map = {}
        for item in data["selected"]:
            if isinstance(item, str):
                selected_map[item.strip().replace("@", "").lower()] = None
            elif isinstance(item, dict):
                username = item.get("username", "").strip().replace("@", "").lower()
                selected_map[username] = item.get("estimated_country")
        
        for lead in db_leads:
            lead_username = lead.get("username", "").lower()
            if lead_username in selected_map:
                # Set geo_country: prefer existing, then LLM estimate
                estimated_country = selected_map[lead_username]
                if estimated_country and not lead.get("geo_country"):
                    lead["geo_country"] = estimated_country
                lead["reasoning"] = f"[LLM Verified] Strong match for target profile & niche '{niche}'"
                selected_leads.append(lead)
                print(f"  [✓ LLM Approved] @{lead.get('username')} (geo={estimated_country or 'Global'})")
        print(f"[+] LLM selected {len(selected_leads)}/{len(db_leads)} leads from DB cache")
    else:
        # LLM filter failed - cap fallback leads to top 5 sorted by followers
        selected_leads = sorted(db_leads, key=lambda x: x.get("followers", 0) or 0, reverse=True)[:min(target_count, 5)]
        for lead in selected_leads:
            lead["reasoning"] = f"[LLM Filter Fallback] Selected top follower lead from DB"
        print(f"[-] LLM filter failed, using top {len(selected_leads)} DB leads (capped at 5) as fallback")
    
    needs_more = len(selected_leads) < target_count
    if needs_more:
        print(f"[i] Have {len(selected_leads)}/{target_count} leads. Will do browser search for more.")
    else:
        print(f"[+] Have {len(selected_leads)}/{target_count} leads. No browser search needed!")
    
    return {"staged_leads": selected_leads, "needs_browser_search": needs_more}

def should_browser_search(state: InstagramAgentState) -> str:
    """Conditional edge: decides whether to do browser search or skip to export."""
    if state.get('needs_browser_search', True):
        return "init_browser"
    return "export"

def init_node(state: InstagramAgentState):
    """Initializes the browser and session."""
    print("\n--- [Node] Initializing Browser ---")
    launch_browser()
    time.sleep(random.uniform(1.0, 3.0))
    return {}

def generate_hashtags_node(state: InstagramAgentState):
    """Generates hashtags based on niche (derived from ICP)."""
    print("\n--- [Node] Generating Hashtags ---")
    niche = state.get('niche', 'lifestyle')
    icp = state.get('icp', {})
    target_profile = icp.get("targetProfile", "")
    focus = icp.get("focus", "")
    
    prompt = f"""
    Given the Campaign Details:
    - Niche: {niche}
    - Target Profile: {target_profile}
    - Focus: {focus}
    
    Provide 3 relevant Instagram hashtags to search for leads during this campaign.
    Respond ONLY with a JSON object like: {{"hashtags": ["tag1", "tag2", "tag3"]}}
    """
    data = invoke_llm_with_retry(prompt)
    if data and "hashtags" in data:
        hashtags = [h.replace("#", "").strip() for h in data["hashtags"]]
        print(f"[+] Generated unique hashtags: {hashtags}")
        return {"hashtags": hashtags}
    else:
        print("[-] Hashtag generation failed after retries.")
        return {"hashtags": [niche.split()[0].lower()]}

def hashtag_search_node(state: InstagramAgentState):
    """Searches hashtags and collects discovered posts."""
    print("\n--- [Node] Searching Hashtags ---")
    all_posts = []
    for hashtag in state.get('hashtags', []):
        results = search_hashtag(hashtag)
        if "posts" in results:
            all_posts.extend(results["posts"])
        time.sleep(random.uniform(2.0, 4.0)) # Reduced delay between hashtag searches
    
    # Deduplicate by username
    seen = set()
    unique_posts = []
    for p in all_posts:
        if p.get("username") and p["username"] not in seen:
            seen.add(p["username"])
            unique_posts.append(p)
            
    print(f"[+] Discovered {len(unique_posts)} unique potential leads.")
    return {"discovered_posts": unique_posts}

def collect_browser_profiles_node(state: InstagramAgentState):
    """
    Collects ALL browser-discovered profiles directly as leads WITHOUT LLM approval.
    Only basic pre-filtering (followers, engagement) is applied.
    """
    print("\n--- [Node] Collecting Browser Profiles (No LLM Approval) ---")
    icp = state.get('icp', {})
    niche = state.get('niche', '')
    
    # Basic follower threshold from ICP
    min_followers_str = str(icp.get("minFollowers", "0")).lower()
    min_f = 0
    if "k" in min_followers_str:
        min_f = int(float(min_followers_str.replace("k", "")) * 1000)
    elif min_followers_str.isdigit():
        min_f = int(min_followers_str)
    
    discovered = state.get('discovered_posts', [])
    existing_leads = list(state.get('staged_leads', []))
    existing_usernames = {l.get('username', '').lower() for l in existing_leads}
    
    # Extract unique usernames from discovered posts (exclude already searched / campaign handles)
    seen = set()
    usernames_to_enrich = []
    for p in discovered:
        username = p.get("username", "")
        u_lower = username.lower()
        if username and u_lower not in seen and u_lower not in existing_usernames and u_lower not in SEARCHED_USERNAMES:
            seen.add(u_lower)
            usernames_to_enrich.append(username)
    
    # Limit to top 25 for enrichment
    usernames_to_enrich = usernames_to_enrich[:25]
    print(f"[+] Will enrich {len(usernames_to_enrich)} new browser-discovered profiles (skipped duplicates)")
    return {"usernames_to_enrich": usernames_to_enrich}

def enrichment_node(state: InstagramAgentState):
    """Enriches browser profiles. Checks database cache first to skip browser navigation for known leads."""
    print("\n--- [Node] Enriching Browser Profiles ---")
    usernames = state.get('usernames_to_enrich', [])
    if not usernames:
        return {"profiles_data": []}

    print(f"[*] Pre-checking database cache for {len(usernames)} candidates...")
    cached_leads = search_existing_leads_sync(icp={}, target_handles=usernames, limit=len(usernames))
    cached_map = {lead['username'].lower(): lead for lead in cached_leads}
    
    profiles = []
    usernames_to_scrape = []
    
    for username in usernames:
        clean_user = username.strip().replace("@", "")
        if clean_user.lower() in cached_map:
            cached = cached_map[clean_user.lower()]
            print(f"[+] Cache HIT: Found @{clean_user} in database. Skipping browser navigation.")
            profiles.append({
                "username": clean_user,
                "bio": cached.get("bio") or (cached.get("profile", {}).get("biography") if isinstance(cached.get("profile"), dict) else "") or "",
                "followers": cached.get("followers", 0),
                "is_private": False,
                "posts": cached.get("posts", []),
                "from_cache": True,
                "creator_info": cached.get("creator_info", ""),
                "reasoning": cached.get("reasoning", "")
            })
        else:
            usernames_to_scrape.append(clean_user)
            
    if usernames_to_scrape:
        print(f"[*] Cache MISS: Scrape {len(usernames_to_scrape)} profiles via browser...")
        scraped_results = search_profile(usernames_to_scrape)
        for res in scraped_results:
            if res.get("found") and res.get("profile"):
                profiles.append({
                    "username": res["username"],
                    "bio": res["profile"].get("biography"),
                    "followers": res["profile"].get("followers"),
                    "is_private": res["profile"].get("is_private"),
                    "posts": res.get("posts", []),
                    "from_cache": False
                })
            time.sleep(random.uniform(2.0, 5.0))
            
    return {"profiles_data": profiles}

def catalogue_and_validate_node(state: InstagramAgentState):
    """
    Two-tier lead processing:
    
    TIER 1 (DB Catalogue): ALL browser-enriched profiles are saved to the DB
    catalogue immediately (no LLM needed). This builds a massive searchable
    catalogue to avoid slow browser traversal in future runs.
    
    TIER 2 (Campaign Leads): LLM validates which profiles are actual campaign
    leads worth pushing through BullMQ results stream.
    
    Uses large batch sizes (~40 profiles per call) to maximize Llama 3.1 8B's
    128K context window and minimize API calls.
    """
    print("\n--- [Node] Catalogue All + LLM Validate Campaign Leads ---")
    icp = state['icp']
    niche = state.get('niche', '')
    
    # Start with existing staged leads from DB phase
    validated_leads = list(state.get('staged_leads', []))
    existing_usernames = {l.get('username', '').lower() for l in validated_leads}
    
    profiles = state.get('profiles_data', [])
    if not profiles:
        print("[-] No browser profiles to process.")
        return {"staged_leads": validated_leads, "catalogue_profiles": []}

    # --- Basic pre-filtering ---
    min_followers_str = str(icp.get("minFollowers", "0")).lower()
    min_f = 0
    if "k" in min_followers_str:
        min_f = int(float(min_followers_str.replace("k", "")) * 1000)
    elif min_followers_str.isdigit():
        min_f = int(min_followers_str)
    
    eligible_profiles = []
    for p in profiles:
        username = p.get("username", "")
        if not username or username.lower() in existing_usernames:
            continue
        if p.get("is_private"):
            print(f"[-] @{username} skipped (private account)")
            continue
        f_count = p.get("followers", 0) or 0
        if f_count < min_f:
            print(f"[-] @{username} filtered out (Followers: {f_count} < {min_f})")
            continue
        eligible_profiles.append(p)
    
    print(f"[+] {len(eligible_profiles)} profiles passed basic filter")
    
    # --- TIER 1: Save ALL eligible profiles to DB catalogue ---
    print(f"[*] TIER 1: Saving all {len(eligible_profiles)} profiles to DB catalogue...")
    save_profiles_to_catalogue_sync(eligible_profiles, niche=niche)
    
    # --- TIER 2: LLM validates which become campaign leads ---
    # To avoid Groq/LLM context_length_exceeded errors (BadRequestError 400),
    # use a compact batch size (5 profiles per call) and trim payload sizes.
    print(f"[*] TIER 2: LLM validating campaign leads from {len(eligible_profiles)} profiles...")
    
    BATCH_SIZE = 5  # Small batch size to guarantee context length compliance
    
    def validate_batch(batch_list: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Helper to construct prompt and invoke LLM for a list of profiles."""
        if not batch_list:
            return None
        batch_info = []
        for p in batch_list:
            posts = p.get("posts", [])
            post_summaries = [{"caption": (post.get("caption") or "")[:60], "likes": post.get("likes", 0)} for post in posts[:2]] if posts else []
            batch_info.append({
                "username": p["username"],
                "bio": (p.get("bio") or "")[:150],
                "followers": p.get("followers", 0),
                "posts": post_summaries
            })
        
        geo_target = icp.get('geoTarget', '')
        geo_instruction_browser = ""
        if geo_target and geo_target.strip().lower() not in ("", "global", "worldwide", "any"):
            geo_instruction_browser = f"""\n\nGEO TARGETING (IMPORTANT):
- Target geography: {geo_target}
- For each profile, estimate their likely country based on their username, full name, bio language, and content.
- ONLY mark as match if they are likely based in or relevant to: {geo_target}
- Include your estimated country in the response."""
        else:
            geo_instruction_browser = """\n\nCOUNTRY ESTIMATION:
- For each matched profile, estimate their likely country based on their username, full name, bio, and content.
- Use naming patterns (e.g., "raj_sharma" -> India, "john_smith" -> US/UK, "sakura_chan" -> Japan)."""
        
        prompt = f"""You are a lead qualification expert for an Instagram outreach campaign.

Campaign Target Settings:
- Industry: {icp.get('industry')}
- Niche: {niche}
- Target Profile: {icp.get('targetProfile')}
- Focus: {icp.get('focus')}
- Exclusions: {icp.get('exclusions')}
- Content Type: {icp.get('contentType', 'any')}

Item being sold: {state.get('item_profile', {}).get('item_to_sell', 'N/A')}
Target audience: {state.get('item_profile', {}).get('target_audience', 'N/A')}
{geo_instruction_browser}

Analyze ALL {len(batch_info)} profiles below and determine which are strong matches for this campaign.
For each match, provide a short creator_info, reasoning, and estimated_country.

Profiles:
{json.dumps(batch_info)}

Respond ONLY with a JSON object:
{{"results": [{{"username": "...", "match": true/false, "reasoning": "...", "creator_info": "...", "estimated_country": "Country Name"}}]}}"""
        return invoke_llm_with_retry(prompt)

    total_batches = (len(eligible_profiles) + BATCH_SIZE - 1) // BATCH_SIZE
    for i in range(0, len(eligible_profiles), BATCH_SIZE):
        batch = eligible_profiles[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        print(f"[*] Validating batch {batch_num}/{total_batches} ({len(batch)} profiles)...")
        
        batch_verdict = validate_batch(batch)
        
        # If main batch fails, attempt sub-batching with smaller mini-batches (size 2)
        if not batch_verdict or "results" not in batch_verdict:
            print(f"[!] Main batch {batch_num} failed. Retrying with mini-batches of size 2...")
            combined_results = []
            for sub_i in range(0, len(batch), 2):
                sub_batch = batch[sub_i:sub_i + 2]
                sub_verdict = validate_batch(sub_batch)
                if sub_verdict and "results" in sub_verdict:
                    combined_results.extend(sub_verdict["results"])
            if combined_results:
                batch_verdict = {"results": combined_results}
        
        if batch_verdict and "results" in batch_verdict:
            for res in batch_verdict["results"]:
                if res.get("match"):
                    username = res.get("username", "").replace("@", "")
                    profile = next((p for p in batch if p['username'].lower() == username.lower()), None)
                    if profile and username.lower() not in existing_usernames:
                        estimated_country = res.get("estimated_country", "")
                        validated_leads.append({
                            "username": profile["username"],
                            "creator_info": res.get("creator_info", ""),
                            "reasoning": res.get("reasoning", ""),
                            "posts": profile.get("posts", []),
                            "followers": profile.get("followers", 0),
                            "bio": profile.get("bio", ""),
                            "geo_country": estimated_country or profile.get("geo_country", ""),
                            "found": True
                        })
                        existing_usernames.add(username.lower())
                        print(f"[+] Campaign Lead Verified: @{profile['username']} (country={estimated_country})")
        else:
            # LLM failed completely - limit fallback to top 5 profiles by follower count
            unvalidated = [p for p in batch if p.get("username", "").lower() not in existing_usernames]
            fallback_top5 = sorted(unvalidated, key=lambda x: x.get("followers", 0) or 0, reverse=True)[:5]
            print(f"[-] LLM validation failed for batch {batch_num}. Pushing only top {len(fallback_top5)} profiles (capped at top 5) as fallback.")
            for p in fallback_top5:
                username = p.get("username", "")
                if username.lower() not in existing_usernames:
                    validated_leads.append({
                        "username": username,
                        "creator_info": (p.get("bio") or "")[:150],
                        "reasoning": f"Browser-discovered in {niche} niche (LLM fallback - top 5 follower ranking)",
                        "posts": p.get("posts", []),
                        "followers": p.get("followers", 0),
                        "bio": p.get("bio", ""),
                        "found": True
                    })
                    existing_usernames.add(username.lower())
    
    print(f"[+] TIER 1: {len(eligible_profiles)} profiles catalogued to DB")
    print(f"[+] TIER 2: {len(validated_leads)} campaign leads validated by LLM")
    return {"staged_leads": validated_leads, "catalogue_profiles": eligible_profiles}

def export_node(state: InstagramAgentState):
    """Pushes leads to global state/storage and saves them to Supabase database."""
    print("\n--- [Node] Exporting Leads to database storage ---")
    leads = state.get('staged_leads', [])
    campaign_id = state.get('campaign_id') or state.get('icp', {}).get('campaignId') or state.get('icp', {}).get('campaign_id')
    niche = state.get('niche', '')
    
    if leads:
        push_leads(leads, campaign_id, niche=niche)
    return {}

# --- Graph Assembly ---

def create_instagram_graph():
    workflow = StateGraph(InstagramAgentState)
    
    # Phase 1: Derive niche from ICP and search DB
    workflow.add_node("derive_niche", derive_niche_node)
    workflow.add_node("db_search", db_search_node)
    workflow.add_node("llm_filter_db", llm_filter_db_leads_node)
    
    # Phase 2: Browser search (conditional - only if more leads needed)
    workflow.add_node("init_browser", init_node)
    workflow.add_node("gen_hashtags", generate_hashtags_node)
    workflow.add_node("search", hashtag_search_node)
    workflow.add_node("collect_profiles", collect_browser_profiles_node)
    workflow.add_node("enrich", enrichment_node)
    workflow.add_node("catalogue_validate", catalogue_and_validate_node)
    
    # Phase 3: Export
    workflow.add_node("export", export_node)
    
    # Flow: derive_niche -> db_search -> llm_filter_db -> (conditional)
    workflow.set_entry_point("derive_niche")
    workflow.add_edge("derive_niche", "db_search")
    workflow.add_edge("db_search", "llm_filter_db")
    
    # Conditional: if enough leads from DB, skip browser; otherwise init browser
    workflow.add_conditional_edges("llm_filter_db", should_browser_search, {
        "init_browser": "init_browser",
        "export": "export"
    })
    
    # Browser search path
    workflow.add_edge("init_browser", "gen_hashtags")
    workflow.add_edge("gen_hashtags", "search")
    workflow.add_edge("search", "collect_profiles")
    workflow.add_edge("collect_profiles", "enrich")
    workflow.add_edge("enrich", "catalogue_validate")
    workflow.add_edge("catalogue_validate", "export")
    
    workflow.add_edge("export", END)
    
    return workflow.compile()

def main():
    icp = {
        "campaignName": "Test Campaign",
        "industry": "SaaS",
        "geoTarget": "Global",
        "targetProfile": "Tech Founders",
        "focus": "B2B",
        "minFollowers": "5000",
        "exclusions": "No students, no crypto",
        "minEngagement": "2%",
        "contentType": "Product Demos",
        "target_lead_count": 5
    }
    
    item_profile = {
        "item_to_sell": "Pulsar AI - An automated lead generation tool.",
        "target_audience": "Content creators and micro-influencers."
    }

    initial_state = {
        "icp": icp,
        "niche": "",
        "item_profile": item_profile,
        "hashtags": [],
        "discovered_posts": [],
        "usernames_to_enrich": [],
        "profiles_data": [],
        "staged_leads": [],
        "catalogue_profiles": [],
        "db_leads": [],
        "needs_browser_search": True,
        "target_lead_count": icp.get("target_lead_count", 10),
        "error": None
    }

    graph = create_instagram_graph()
    print("[*] Starting Instagram Lead Gen Graph...")
    final_state = graph.invoke(initial_state)
    
    print("\n" + "="*50)
    print("GRAPH EXECUTION COMPLETE")
    print(f"Total Leads Staged: {len(STAGED_LEADS)}")
    print(json.dumps(STAGED_LEADS, indent=4))
    print("="*50)

    print("\n[+] Press Ctrl+C to close browser and exit.")
    try:
        page = _get_page()
        if page:
            page.wait_for_event("close", timeout=0)
    except:
        pass

if __name__ == "__main__":
    main()
