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
    
        for username in usernames:
            username = username.strip().replace("@", "")
            
            if username in SEARCHED_USERNAMES:
                print(f"[i] Skipping already searched profile: @{username}")
                continue
                
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
                posts = [d for d in INTERCEPTED_DATA if d.get("type") == "post"][:5]
                
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

def main():
    global page
    # Example ICP and Item Profile
    icp = {
        "niche": ["lifestyle", "entrepreneurship", "motivational"],
        "follower_range": { "min": 5000, "max": 100000 },
        "engagement_rate_min": 0.02,
        "audience_demographics": { "location": "US/Europe", "age_range": "20-40" },
        "content_language": "en",
        "posting_frequency_min": "2/week"
    }
    
    item_profile = {
        "item_to_sell": "Pulsar AI - An automated lead generation and outreach tool for Instagram creators.",
        "price": "$99/month",
        "target_audience": "Content creators, coaches, and micro-influencers who want to monetize their audience."
    }

    print(f"Starting lead generation for niche: {icp['niche']}")
    
    # Launch browser first
    launch_browser()
    
    config = {"configurable": {"thread_id": "instagram_lead_gen_v1"}}

    # Inside main()
    target_niches = ", ".join(icp['niche'])

    unified_content = f"""
    EXECUTE TASK NOW: 
    Find 50 potential leads in the following niches: {target_niches}.
    Start by calling search_hashtag for each niche.

    1. Use search_hashtag for each of these: {", ".join(icp['niche'])}.
    2. From the results, call search_profile on the usernames found which match the ICP.
    3. If they have between {icp['follower_range']['min']} and {icp['follower_range']['max']} followers, call push_leads.

    TARGET ICP DATA: 
    {json.dumps(icp)}

    ITEM PROFILE DATA: 
    {json.dumps(item_profile)}
    """

    instagram_agent = get_instagram_agent()
    config = {"configurable": {"thread_id": "instagram_lead_gen_v1"}}
    
    # 3. Pass it strictly as a single user string element
    response = instagram_agent.invoke(
        {
            "messages": [
                {"role": "user", "content": unified_content}
            ]
        },
        config=config
    )
    
    print("\n" + "="*50)
    print("FINAL AGENT RESPONSE:")
    # Print the farewell message
    if "messages" in response and response["messages"]:
        last_message = response["messages"][-1]
        print(last_message.content)
    
    print("\n" + "STAGED LEADS COLLECTED:")
    print(json.dumps(STAGED_LEADS, indent=4))
    print("="*50)

    # Keep browser open at the end
    print("\n[+] Tasks complete. Press Ctrl+C to close browser and exit.")
    try:
        if page:
            page.wait_for_event("close", timeout=0)
    except Exception:
        pass
    finally:
        # Clean up safely
        try:
            if browser_context:
                browser_context.close()
            if playwright_instance:
                playwright_instance.stop()
        except:
            pass

def get_instagram_agent():
    return create_deep_agent(
        model=ChatOllama(model="gemma4:e4b", temperature=0),
        system_prompt="""
        You are a lead generation bot. You only respond with tool calls.
        
        RULES:
        1. Your FIRST action must be search_hashtag.
        2. NEVER use search_profile for niche keywords (lifestyle, entrepreneur, etc).
        3. Only use search_profile once you have specific usernames which match the ICP from a hashtag search.
        4. When you have found valid leads, call push_leads immediately.
        5. DO NOT talk to the user. Only call tools.
        """,
        tools=[search_hashtag, search_profile, push_leads, sleep],
    )
    
if __name__ == "__main__":
    main()
