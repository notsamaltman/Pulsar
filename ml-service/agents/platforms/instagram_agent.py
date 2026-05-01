from playwright.sync_api import sync_playwright
import random
import time
import json
import os
from pathlib import Path

# Get the directory where instagram_agent.py actually lives
script_dir = Path(__file__).parent
# Go up or into the context folder correctly
context_path = script_dir / "context" / "instagram_context.json"

with open(context_path, 'r') as file:
    context = json.load(file)

def human_type(page, selector, text):
    # Click to focus the box first, like a human would
    page.click(selector)
    
    # Type each character with a random delay
    for char in text:
        page.keyboard.type(char, delay=random.randint(50, 150))
        if random.random() > 0.9:
            time.sleep(random.uniform(0.1, 0.3))

def handle_email_verification(page, context):
    print("Checking for email verification screen...")
    
    # Selectors from your JSON
    code_input_selector = context['selectors']['security']['code_input']
    continue_btn_selector = context['selectors']['security']['continue_button']

    try:
        # Wait up to 10s for the "Code" input to appear
        page.wait_for_selector(code_input_selector, state="visible", timeout=10000)
        
        print("\n[!] Email verification detected.")
        verification_code = input(">>> Enter the 6-digit code sent to your email: ")
        
        # Fill the code and click continue
        human_type(page, code_input_selector, verification_code)
        page.click(continue_btn_selector)
        
        print("[+] Code submitted! Waiting for dashboard...")
        page.wait_for_load_state("networkidle")
        
    except Exception as e:
        print("[+] No verification screen found, proceeding with normal login.")


with sync_playwright() as p:
    # Launching with a specific user data dir helps bypass bot detection 
    # and keeps you logged in across sessions
    user_data_dir = "./browser_data" 
    
    email = os.getenv("INSTAGRAM_EMAIL")
    password = os.getenv("INSTAGRAM_PASSWORD")

    browser = p.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        args=["--no-sandbox", "--disable-setuid-sandbox"],
        # Common practice to avoid basic bot detection
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
    
    page = browser.pages[0] if browser.pages else browser.new_page()
    page.goto("https://www.instagram.com")
    
    # Keep the browser open for a bit to see what happens
    print("Browser is open. Close the window or press Ctrl+C to stop.")

    time.sleep(random.randint(3, 6))

    human_type(page, context['selectors']['login']['username_input'], email)
    human_type(page, context['selectors']['login']['password_input'], password)

    time.sleep(random.randint(1, 3))

    page.click(context['selectors']['login']['login_button'])

    handle_email_verification(page, context)
    # Wait for the browser to be closed manually
    page.wait_for_event("close", timeout=0) 
