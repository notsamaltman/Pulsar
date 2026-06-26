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
from langchain_ollama import ChatOllama
from langgraph.graph import StateGraph, END
from typing import TypedDict, List, Dict, Any, Optional, Set
import operator

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
    icp: Dict[str, Any] # Contains campaign inputs: industry, targetProfile, focus, etc.
    item_profile: Dict[str, Any]
    hashtags: List[str]
    discovered_posts: List[Dict[str, Any]] # Raw posts from hashtags
    usernames_to_enrich: List[str]
    profiles_data: List[Dict[str, Any]] # Full bio + metrics
    staged_leads: List[Dict[str, Any]]
    error: Optional[str]


def _get_page():
    """Returns a thread-safe page object. Uses CDP connection if in a child thread."""
    global page, _main_thread_id
    
    # Check thread-local storage first
    if hasattr(_thread_local, "page") and _thread_local.page:
        try:
            _thread_local.page.url
            return _thread_local.page
        except:
            pass

    # Main thread can use the global handle
    if threading.get_ident() == _main_thread_id:
        if page:
            try:
                page.url
                _thread_local.page = page
                return page
            except:
                pass

    # All other threads (or main thread if global is missing) connect via CDP
    try:
        from playwright.sync_api import sync_playwright
        if not hasattr(_thread_local, "playwright"):
            # Start a separate playwright instance for this thread
            _thread_local.playwright = sync_playwright().start()
        
        # Connect to the browser started in launch_browser (port 9222)
        # Using a small timeout for the connection
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
        # If we are in main thread, maybe we haven't set _main_thread_id yet
        if page: return page
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
context_path = script_dir / "context" / "instagram_context.json"
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

    return extracted

class Lead(BaseModel):
    """Pydantic model for validating lead data."""
    username: str = Field(..., description="The creator's handle.")
    creator_info: str = Field(..., description="Short description of who they are and what they do.")
    reasoning: str = Field(..., description="Detailed reasoning why they match the ICP and product.")
    posts: List[Dict[str, Any]] = Field(..., description="Array of recent posts with url and media_url.")
    found: bool = Field(True, description="Whether the profile was successfully analyzed.")

def push_leads(leads: List[Dict[str, Any]]):
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
    # revert to explore/tags which the user says was working
    page.goto(f"https://www.instagram.com/explore/tags/{hashtag}/")
    
    try:
        # Wait for initial load
        post_item_selector = context['selectors']['navigation'].get('search_results_item', "a[href*='/p/'], a[href*='/reel/']")
        page.wait_for_selector(post_item_selector, timeout=15000)
        
        # Scroll down a bit to trigger more data requests
        print("[+] Scrolling to load more content...")
        for _ in range(5): # Increase scrolls
            page.mouse.wheel(0, 2000) # Use mouse.wheel as in the working script
            time.sleep(random.uniform(2.0, 3.0))
        
        # Give it a few seconds to trigger more network requests
        print("[+] Waiting for network interception to complete...")
        time.sleep(5) 
        
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
                delay = random.uniform(10.0, 25.0)
                print(f"[*] Sleeping for {delay:.2f}s before next profile...")
                time.sleep(delay)

            print(f"[+] Navigating to profile: @{username}")
            INTERCEPTED_DATA = [] # Clear for each user 
            try:
                page.goto(f"https://www.instagram.com/{username}/")
                
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
        _main_thread_id = threading.get_ident() # Store the main thread id
        email = os.getenv("INSTAGRAM_EMAIL")
    password = os.getenv("INSTAGRAM_PASSWORD")

    if not email or not password:
        print("Error: INSTAGRAM_EMAIL and INSTAGRAM_PASSWORD env variables must be set.")
        return

    if not playwright_instance:
        from playwright.sync_api import sync_playwright
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
    page.goto("https://www.instagram.com")
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

llm = ChatOllama(model="gemma4:e4b", format="json", temperature=0)

def invoke_llm_with_retry(prompt: str, max_retries: int = 3) -> Optional[Dict[str, Any]]:
    """Invokes LLM with retries and robust JSON extraction."""
    for i in range(max_retries):
        try:
            # Add a small delay between retries
            if i > 0:
                time.sleep(random.uniform(1.0, 3.0))
                
            response = llm.invoke(prompt)
            content = response.content.strip()
            
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

# --- LangGraph Nodes ---

def init_node(state: InstagramAgentState):
    """Initializes the browser and session."""
    print("\n--- [Node] Initializing Browser ---")
    launch_browser()
    time.sleep(random.uniform(2.0, 5.0))
    return {}

def generate_hashtags_node(state: InstagramAgentState):
    """Gemma generates hashtags based on ICP."""
    print("\n--- [Node] Generating Hashtags ---")
    icp = state.get('icp', {})
    industry = icp.get("industry", "lifestyle")
    target_profile = icp.get("targetProfile", "")
    focus = icp.get("focus", "")
    
    prompt = f"""
    Given the Campaign Details:
    - Industry: {industry}
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
        return {"hashtags": [industry.lower()]}

def hashtag_search_node(state: InstagramAgentState):
    """Searches hashtags and collects discovered posts."""
    print("\n--- [Node] Searching Hashtags ---")
    all_posts = []
    for hashtag in state.get('hashtags', []):
        results = search_hashtag(hashtag)
        if "posts" in results:
            all_posts.extend(results["posts"])
        time.sleep(random.uniform(3.0, 7.0)) # Delay between hashtag searches
    
    # Deduplicate by username
    seen = set()
    unique_posts = []
    for p in all_posts:
        if p.get("username") and p["username"] not in seen:
            seen.add(p["username"])
            unique_posts.append(p)
            
    print(f"[+] Discovered {len(unique_posts)} unique potential leads.")
    return {"discovered_posts": unique_posts}

def filter_profiles_node(state: InstagramAgentState):
    """Gemma filters raw posts to pick promising usernames."""
    print("\n--- [Node] Filtering Usernames ---")
    icp = state['icp']
    target_count = icp.get("target_lead_count", 10) # Default to 10 for more leads
    exclusions = icp.get("exclusions", "")
    min_followers = icp.get("minFollowers", "any")
    
    candidates = []
    # Take more discovered posts to find better leads
    for p in state.get('discovered_posts', [])[:50]: 
        candidates.append({
            "username": p.get("username"),
            "caption": p.get("caption", "")[:150]
        })
    
    if not candidates:
        print("[-] No candidates discovered.")
        return {"usernames_to_enrich": []}

    print(f"[*] Analyzing {len(candidates)} candidates to pick top ~20 promising profiles...")
    
    prompt = f"""
    Industry: {icp.get('industry')}
    Target: {icp.get('targetProfile')}
    
    Pick TOP 15 handles from these {len(candidates)} candidates for a SaaS outreach campaign.
    
    Candidates: {json.dumps(candidates)}
    
    Respond ONLY with a JSON object: {{"usernames": ["handle1", "handle2", ...]}}
    """
    data = invoke_llm_with_retry(prompt)
    if data and "usernames" in data:
        usernames = [u.strip().replace("@", "") for u in data["usernames"]]
        print(f"[+] Picked {len(usernames)} potential usernames for enrichment.")
        return {"usernames_to_enrich": usernames}
    else:
        # Fallback
        fallback = [c['username'] for c in candidates[:20]]
        return {"usernames_to_enrich": fallback}

def enrichment_node(state: InstagramAgentState):
    """Gets detailed profile info for filtered users."""
    print("\n--- [Node] Enriching Profiles ---")
    usernames = state.get('usernames_to_enrich', [])
    if not usernames:
        return {"profiles_data": []}
        
    results = search_profile(usernames)
    profiles = []
    for res in results:
        if res.get("found") and res.get("profile"):
            profiles.append({
                "username": res["username"],
                "bio": res["profile"].get("biography"),
                "followers": res["profile"].get("followers"),
                "is_private": res["profile"].get("is_private"),
                "posts": res.get("posts", [])
            })
        time.sleep(random.uniform(4.0, 8.0)) # Stronger delay between profile enrichment
    return {"profiles_data": profiles}

def validation_node(state: InstagramAgentState):
    """Final check on enriched data with pre-LLM filtering and increased batch size."""
    print("\n--- [Node] Final Validation ---")
    profiles = state.get('profiles_data', [])
    icp = state['icp']
    
    if not profiles:
        print("[-] No profiles to validate.")
        return {"staged_leads": []}

    # --- Pre-LLM Filtering ---
    min_followers_str = str(icp.get("minFollowers", "0")).lower()
    min_f = 0
    if "k" in min_followers_str:
        min_f = int(float(min_followers_str.replace("k", "")) * 1000)
    elif min_followers_str.isdigit():
        min_f = int(min_followers_str)
    
    filtered_profiles = []
    for p in profiles:
        f_count = p.get("followers", 0) or 0
        if f_count < min_f:
            print(f"[-] @{p['username']} filtered out (Followers: {f_count} < {min_f})")
            continue
            
        # Optional: Check engagement
        posts = p.get("posts", [])
        if posts:
            avg_likes = sum(post.get("likes", 0) for post in posts) / len(posts)
            if avg_likes < 5: # Basic filter for inactive/very low engagement accounts
                print(f"[-] @{p['username']} filtered out (Low engagement: {avg_likes} avg likes)")
                continue
        
        filtered_profiles.append(p)
        
    print(f"[*] {len(filtered_profiles)} profiles passed pre-filter (out of {len(profiles)})")

    validated_leads = []
    batch_size = 5 # Increased batch size for efficiency
    
    for i in range(0, len(filtered_profiles), batch_size):
        batch = filtered_profiles[i:i + batch_size]
        print(f"[*] Analyzing batch of {len(batch)}: {', '.join(['@' + p['username'] for p in batch])}")
        
        batch_info = []
        for profile in batch:
            batch_info.append({
                "username": profile["username"],
                "bio": profile.get("bio", "")[:200],
                "followers": profile.get("followers", 0),
                "posts": [{"caption": p.get("caption", "")[:60], "likes": p.get("likes", 0)} for p in profile.get("posts", [])[:3]]
            })

        prompt = f"""
        Campaign Target Settings:
        - Industry: {icp.get('industry')}
        - Target Profile: {icp.get('targetProfile')}
        - Exclusions: {icp.get('exclusions')}
        
        Analyze relevance for: {json.dumps(batch_info)}
        Respond ONLY with a JSON object:
        {{"results": [{{"username": "...", "match": true/false, "reasoning": "...", "creator_info": "..."}}]}}
        """
        batch_verdict = invoke_llm_with_retry(prompt)
        
        if batch_verdict and "results" in batch_verdict:
            for res in batch_verdict["results"]:
                if res.get("match"):
                    username = res.get("username", "").replace("@", "")
                    profile = next((p for p in batch if p['username'].lower() == username.lower()), None)
                    if profile:
                        validated_leads.append({
                            "username": profile["username"],
                            "creator_info": res.get("creator_info", ""),
                            "reasoning": res.get("reasoning", ""),
                            "posts": profile.get("posts", []),
                            "found": True
                        })
                        print(f"[+] Lead Verified: @{profile['username']}")
            
    return {"staged_leads": validated_leads}

def export_node(state: InstagramAgentState):
    """Pushes leads to global state/storage."""
    print("\n--- [Node] Exporting Leads ---")
    leads = state.get('staged_leads', [])
    if leads:
        push_leads(leads)
    return {}

# --- Graph Assembly ---

def create_instagram_graph():
    workflow = StateGraph(InstagramAgentState)
    
    workflow.add_node("init", init_node)
    workflow.add_node("gen_hashtags", generate_hashtags_node)
    workflow.add_node("search", hashtag_search_node)
    workflow.add_node("filter", filter_profiles_node)
    workflow.add_node("enrich", enrichment_node)
    workflow.add_node("validate", validation_node)
    workflow.add_node("export", export_node)
    
    workflow.set_entry_point("init")
    workflow.add_edge("init", "gen_hashtags")
    workflow.add_edge("gen_hashtags", "search")
    workflow.add_edge("search", "filter")
    workflow.add_edge("filter", "enrich")
    workflow.add_edge("enrich", "validate")
    workflow.add_edge("validate", "export")
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
        "target_lead_count": 20
    }
    
    item_profile = {
        "item_to_sell": "Pulsar AI - An automated lead generation tool.",
        "target_audience": "Content creators and micro-influencers."
    }

    initial_state = {
        "icp": icp,
        "item_profile": item_profile,
        "hashtags": [],
        "discovered_posts": [],
        "usernames_to_enrich": [],
        "profiles_data": [],
        "staged_leads": [],
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
