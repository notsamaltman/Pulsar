import random
import time
import json
import os
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

# Get the directory where instagram_agent.py actually lives
script_dir = Path(__file__).parent
context_path = script_dir / "context" / "instagram_context.json"
session_path = script_dir / "session.json"

with open(context_path, 'r') as file:
    context = json.load(file)

def human_type(page, selector, text):
    """Types text like a human with random delays between keystrokes."""
    page.click(selector)
    for char in text:
        page.keyboard.type(char, delay=random.randint(50, 150))
        if random.random() > 0.9:
            time.sleep(random.uniform(0.1, 0.3))

def save_session(browser_context, username):
    """Saves the current browser state (cookies, local storage) and metadata."""
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

def is_logged_in(page):
    """Checks if the user is currently logged in by looking for common home elements or interstitials."""
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

def detect_challenge(page):
    """
    Checks the page for common Instagram challenges, reCAPTCHA, 
    or suspicious activity warnings.
    """
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

def detect_login_errors(page):
    """
    Checks the page for login-specific errors like incorrect password
    or account not found.
    """
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

def handle_email_verification(page, context):
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

def handle_post_login_interstitials(page, context):
    """Handles and skips post-login interstitials like 'Save Info' and 'Notifications'."""
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

def login_and_save(page, browser_context, email, password):
    """Performs the full login flow and saves the session."""
    page.goto("https://www.instagram.com")
    time.sleep(random.randint(3, 6))

    # Initial check for any existing challenges (e.g., suspicious IP)
    if detect_challenge(page):
        print("\n" + "!"*50)
        print("ACTION REQUIRED: A challenge/reCAPTCHA was detected before login.")
        print("Please solve it in the browser window and then press Enter here.")
        print("!"*50)
        input(">>> Press Enter after solving the challenge...")

    # Check if we are already on the login page
    if page.query_selector(context['selectors']['login']['username_input']):
        print(f"Logging in as {email}...")
        human_type(page, context['selectors']['login']['username_input'], email)
        human_type(page, context['selectors']['login']['password_input'], password)
        time.sleep(random.randint(1, 3))
        page.click(context['selectors']['login']['login_button'])

        # Wait and check for errors or challenges
        time.sleep(5)
        if detect_login_errors(page):
            print("[-] Login failed due to incorrect credentials.")
            return False

        if detect_challenge(page):
            print("\n" + "!"*50)
            print("ACTION REQUIRED: reCAPTCHA or Challenge detected after login.")
            print("Please solve it in the browser window and then press Enter here.")
            print("!"*50)
            input(">>> Press Enter after solving the challenge...")

        handle_email_verification(page, context)
        
        # Wait for login to complete and handle interstitials
        page.wait_for_load_state("networkidle")
        handle_post_login_interstitials(page, context)
        
    if is_logged_in(page):
        # Extract username if possible from the UI or just use the email prefix
        username = email.split('@')[0] 
        save_session(browser_context, username)
        return True
    return False

def main():
    load_dotenv()

    email = os.getenv("INSTAGRAM_EMAIL")
    password = os.getenv("INSTAGRAM_PASSWORD")

    if not email or not password:
        print("Error: INSTAGRAM_EMAIL and INSTAGRAM_PASSWORD env variables must be set.")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(
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

        print("Checking session validity...")
        if is_logged_in(page):
            print(f"[+] Valid session found for {session_data.get('username')}. Reusing...")
        else:
            print("[!] Session expired or not found. Logging in...")
            if not login_and_save(page, browser_context, email, password):
                print("[-] Login failed.")
            else:
                print("[+] Login successful and session saved.")

        # Keep browser open
        print("\nFlow complete. Browser is open. Close window to exit.")
        try:
            page.wait_for_event("close", timeout=0)
        except KeyboardInterrupt:
            pass
        finally:
            browser_context.close()

if __name__ == "__main__":
    main()
