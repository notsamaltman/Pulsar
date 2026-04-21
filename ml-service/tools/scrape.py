from playwright.sync_api import sync_playwright
import json

def run_scraper(url):
    with sync_playwright() as p:
        # Launch browser (use headless=False if you want to see it happen)
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # Navigate to the URL
        print(f"Navigating to {url}...")
        page.goto(url)
        
        # Wait for React to finish rendering (network idle is a good proxy)
        page.wait_for_load_state("networkidle")

        # Define the tags we want to target
        tags = ["h1", "h2", "h3", "p", "li", "span"]
        scraped_data = []

        # Use query_selector_all to find all instances of our tags
        # Joining tags with a comma creates a CSS "multiple selector"
        elements = page.query_selector_all(", ".join(tags))

        for el in elements:
            scraped_data.append({
                "tag": el.evaluate("node => node.tagName.toLowerCase()"),
                "text": el.inner_text().strip()
            })

        # Close the browser
        browser.close()
        
        # Filter out empty results
        return [item for item in scraped_data if item['text']]

# Example Usage
target_url = "https://scrapfly.io/blog/posts/web-scraping-with-selenium-and-python" # Replace with your React site
results = run_scraper(target_url)

# Output as JSON
print(json.dumps(results, indent=2))