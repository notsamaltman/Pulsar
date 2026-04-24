from playwright.sync_api import sync_playwright

def run_scraper(url):
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        )
        page = context.new_page()
        
        print(f"Navigating to {url}...")
        try:
            page.goto(url, wait_until="networkidle", timeout=60000)
            
            # Scrolling to trigger lazy loading
            print("Scrolling to load dynamic content...")
            for i in range(5):
                page.mouse.wheel(0, 1000)
                page.wait_for_timeout(500)
            
            # Wait for a bit more to let hydration finish
            page.wait_for_timeout(2000)

            # Robust extraction logic
            # We use evaluate to get all text and meaningful links
            scraped_data = page.evaluate("""
                () => {
                    const data = [];
                    const walk = (node) => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            const text = node.textContent.trim();
                            if (text && text.length > 2) {
                                let parent = node.parentElement;
                                let tag = parent ? parent.tagName.toLowerCase() : 'text';
                                
                                // Skip script, style tags
                                if (['script', 'style', 'noscript'].includes(tag)) return;
                                
                                data.append({
                                    tag: tag,
                                    text: text,
                                    isLink: parent.tagName === 'A'
                                });
                            }
                        } else {
                            for (let child of node.childNodes) {
                                walk(child);
                            }
                        }
                    };
                    // Instead of full walk, let's use a more structured approach
                    // to avoid extreme noise but catch all info
                    const selectors = 'h1, h2, h3, h4, h5, h6, p, li, a, span, table, td, th';
                    const elements = document.querySelectorAll(selectors);
                    const results = [];
                    elements.forEach(el => {
                        const text = el.innerText.trim();
                        if (text && !el.querySelector(selectors)) { // avoid nested duplicates
                            results.push({
                                tag: el.tagName.toLowerCase(),
                                text: text,
                                href: el.tagName === 'A' ? el.href : null
                            });
                        }
                    });
                    return results;
                }
            """)

            result = ""
            for data in scraped_data:
                result += (data['text']+" ")
            return result

        except Exception as e:
            print(f"Error scraping {url}: {e}")
            return "Failed to scrape website."
        finally:
            browser.close()
