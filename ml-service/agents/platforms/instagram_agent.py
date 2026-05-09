import random
import time
import json
import os
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import BrowserContext, sync_playwright
from deepagents import create_deep_agent
from typing import Dict, Any, List
import sys

# --- Global Storage for Intercepted Data ---
INTERCEPTED_DATA = []
page = None
browser_context = None
playwright_instance = None

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

def recursive_find_media(data, found_items):
    """Recursively searches for XDTMediaDict or items that look like media."""
    if isinstance(data, dict):
        # Check if this dict itself is a media item
        if data.get("__typename") == "XDTMediaDict" or (data.get("pk") and data.get("code") and "user" in data):
            found_items.append(data)
            return

        # Check for "items" or "edges"
        if "items" in data and isinstance(data["items"], list):
            for item in data["items"]:
                recursive_find_media(item, found_items)
        if "edges" in data and isinstance(data["edges"], list):
            for edge in data["edges"]:
                node = edge.get("node")
                if node:
                    # Special handling for standard GraphQL nodes
                    if node.get("__typename") == "GraphImage" or node.get("__typename") == "GraphVideo" or node.get("__typename") == "GraphSidecar":
                        # Convert node to a common format or just store it
                        INTERCEPTED_DATA.append({
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
                        recursive_find_media(node, found_items)
        
        # Recurse into all values
        for value in data.values():
            if isinstance(value, (dict, list)):
                recursive_find_media(value, found_items)
                
    elif isinstance(data, list):
        for item in data:
            recursive_find_media(item, found_items)

def handle_response(response):
    if response.status == 200:
        url = response.url
        # Ignore common non-data assets
        if any(ext in url for ext in [".jpg", ".png", ".webp", ".mp4", ".woff", ".css", ".js"]):
            return

        try:
            # Try to parse as JSON regardless of content-type for robustness
            data = response.json()
            
            found_xdt_items = []
            recursive_find_media(data, found_xdt_items)
            
            if found_xdt_items:
                parsed = parse_xdt_media(found_xdt_items)
                if parsed:
                    print(f"[+] Intercepted {len(parsed)} posts via recursive search...")
                    INTERCEPTED_DATA.extend(parsed)

        except:
            pass

def human_type(selector, text):
    """Types text like a human with random delays between keystrokes."""
    global page
    page.click(selector)
    for char in text:
        page.keyboard.type(char, delay=random.randint(50, 150))
        if random.random() > 0.9:
            time.sleep(random.uniform(0.1, 0.3))

def save_session(username):
    """Saves the current browser state (cookies, local storage) and metadata."""
    global browser_context
    storage_state = browser_context.storage_state()
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
    global page
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
    global page
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
    global page
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
    global page
    print("Checking for email verification screen...")
    
    code_input_selector = context['selectors']['security']['code_input']
    continue_btn_selector = context['selectors']['security']['continue_button']

    try:
        page.wait_for_selector(code_input_selector, state="visible", timeout=10000)
        print("\n[!] Email verification detected.")
        verification_code = input(">>> Enter the 6-digit code sent to your email: ")
        human_type(page, code_input_selector, verification_code)
        page.click(continue_btn_selector)
        print("[+] Code submitted! Waiting for dashboard...")
        page.wait_for_load_state("networkidle")
    except Exception:
        print("[+] No verification screen found, proceeding.")

def handle_post_login_interstitials(context):
    """Handles and skips post-login interstitials like 'Save Info' and 'Notifications'."""
    global page
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
    global page, browser_context
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
    Prioritizes data intercepted from official GraphQL/API responses.
    
    Returns:
        dict: A dictionary containing:
            - hashtag (str): The searched hashtag.
            - post_count (int): Number of posts found.
            - posts (list): List of post dictionaries, each containing:
                - id (str): Post PK.
                - shortcode (str): Post shortcode.
                - url (str): Link to the post.
                - username (str): Creator's username.
                - full_name (str): Creator's full name.
                - caption (str): Post caption text.
                - likes (int): Like count.
                - comments (int): Comment count.
                - media_url (str): Link to the post's image or video.
                - timestamp (int): Taken at timestamp.
            - method (str): "graphql" or "dom_scraping".
    """
    global page
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

def launch_browser():
    """
    Launches browser and automatically completes authentication + session saving
    and navigates to instagram

    """
    global page, browser_context, playwright_instance
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
        args=["--no-sandbox", "--disable-setuid-sandbox"],
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


def main():
    launch_browser()
    time.sleep(4)
    result = search_hashtag("eccentricmovement")
    print(result)
    
    # Keep browser open at the end if desired
    print("\n[+] Tasks complete. Press Ctrl+C to close browser and exit.")
    try:
        page.wait_for_event("close", timeout=0)
    except KeyboardInterrupt:
        pass
    finally:
        if browser_context:
            browser_context.close()
        if playwright_instance:
            playwright_instance.stop()

instagram_agent = create_deep_agent(
    model="google_genai:gemini-2.5-flash",
    system_prompt=
    """
    You are an expert instagram lead generation agent. You will receive an Ideal Candidate Profile (ICP) which looks like this:

    {
        "niche": ["fitness", "nutrition"],
        "follower_range": { "min": 10000, "max": 500000 },
        "engagement_rate_min": 0.03,
        "audience_demographics": { "location": "US", "age_range": "18-35" },
        "content_language": "en",
        "posting_frequency_min": "3/week"
    }

    Your goal is to find leads by searching relevant hashtags and evaluating the returned posts.

    Tools available:
    - launch_browser(): Launches browser, performs automatic login, and persists the session.
    - search_hashtag(hashtag: str): Searches for a hashtag and returns a dictionary with post data.
        Return schema:
        {
            "hashtag": str,
            "post_count": int,
            "posts": [
                {
                    "id": str,
                    "shortcode": str,
                    "url": str,
                    "username": str,
                    "full_name": str,
                    "caption": str,
                    "likes": int,
                    "comments": int,
                    "media_url": str,
                    "timestamp": int
                }
            ],
            "method": str
        }

    Usage Pattern:
    1. Call launch_browser() once at the start of your session.
    2. Call search_hashtag(hashtag) for relevant niche hashtags.
    3. Iterate through the returned posts and identify leads that match the ICP based on captions, engagement (likes/comments), and overall niche relevance.
    """,
    tools=[
        launch_browser,
        search_hashtag,
    ]
)

if __name__ == "__main__":
    main()
