"""
Standalone test for the company_builder summary generation logic.
Runs the Groq prompt directly — no BullMQ, no Redis, no LangGraph.

Usage (from ml-service directory):
    python -m tests.test_company_builder
"""

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.groq_model import GroqModel

# ── Test cases ────────────────────────────────────────────────────────────────
TEST_CASES = [
    {
        "label": "Zenstar.ai — AI photo editor startup",
        "name": "Zenstar.ai",
        "website": "",
        "description": (
            "We are an AI photo editing startup similar to that of photoshop but with "
            "next gen AI features like removing backgrounds, changing them, adding or "
            "removing people, and overall editing your photo with prompts"
        ),
        "scraped_content": "No content scraped.",
        "expect_valid": True,
    },
    {
        "label": "Stripe — well-known company",
        "name": "Stripe",
        "website": "https://stripe.com",
        "description": "Payment infrastructure for the internet.",
        "scraped_content": "No content scraped.",
        "expect_valid": True,
    },
    {
        "label": "Early-stage SaaS with informal description",
        "name": "Loopwise",
        "website": "",
        "description": "We help small teams track their customer feedback and turn it into features automatically using AI",
        "scraped_content": "No content scraped.",
        "expect_valid": True,
    },
    {
        "label": "Obvious gibberish — should be INVALID",
        "name": "asdfgh",
        "website": "",
        "description": "qwerty uiop lkjhgf",
        "scraped_content": "No content scraped.",
        "expect_valid": False,
    },
    {
        "label": "Personal blog — borderline, model may summarize",
        "name": "My Blog",
        "website": "https://mycooldiary.blogspot.com",
        "description": "I write about my cat and daily life",
        "scraped_content": "No content scraped.",
        "expect_valid": True,  # Qwen summarizes this; acceptable — real gibberish is still caught
    },
]

# ── Prompt (kept in sync with company_builder.py) ─────────────────────────────
def build_prompt(name: str, website: str, description: str, scraped_content: str) -> str:
    return f"""You are an expert business analyst. Analyze the information below and return a concise, professional 2-3 sentence summary of what this company does, their core services, and their target audience.

Company Name: {name}
Website URL: {website or "No URL provided"}
Company Description (provided by founder): {description or "No description provided."}
Scraped Website Content:
---
{scraped_content}
---

Rules:
1. Return ONLY the summary paragraph. No preamble, no labels, no self-references.
2. Return EXACTLY the string INVALID_CONTENT (nothing else) only when ALL three of these are simultaneously true:
   - The company name is obvious gibberish or random characters (e.g. "asdfgh")
   - AND the description is also gibberish or completely empty (e.g. "qwerty uiop")
   - AND there is no usable scraped content
   Startups, early-stage companies, SaaS tools, AI products, side projects, and informally-described businesses are all legitimate — summarize them."""


# ── Detection logic (matches company_builder.py exactly) ─────────────────────
def is_invalid(raw: str) -> bool:
    stripped = raw.strip()
    return stripped == "INVALID_CONTENT" or stripped.startswith("INVALID_CONTENT\n")


# ── Runner ────────────────────────────────────────────────────────────────────
def run_tests():
    print("=" * 70)
    print("  Company Builder — Groq Prompt Test")
    print("=" * 70)

    model = GroqModel()
    passed = 0
    failed = 0

    for tc in TEST_CASES:
        print(f"\n▶  {tc['label']}")
        print(f"   Name:        {tc['name']}")
        print(f"   Website:     {tc['website'] or '(none)'}")
        print(f"   Description: {tc['description'][:80]}...")

        prompt = build_prompt(
            tc["name"], tc["website"], tc["description"], tc["scraped_content"]
        )

        try:
            raw = model.run(prompt)
            stripped = raw.strip()
            detected_invalid = is_invalid(raw)

            print(f"\n   RAW RESPONSE ({len(raw)} chars):")
            print("   " + "\n   ".join(stripped[:400].splitlines()))
            if len(stripped) > 400:
                print("   ... (truncated)")

            if tc["expect_valid"] and not detected_invalid:
                status = "✅ PASS — correctly identified as valid"
                passed += 1
            elif not tc["expect_valid"] and detected_invalid:
                status = "✅ PASS — correctly identified as invalid"
                passed += 1
            elif tc["expect_valid"] and detected_invalid:
                status = "❌ FAIL — false positive: valid company marked INVALID"
                failed += 1
            else:
                status = "❌ FAIL — false negative: invalid input not caught"
                failed += 1

            print(f"\n   {status}")

        except Exception as e:
            print(f"   💥 ERROR: {e}")
            failed += 1

        print("   " + "-" * 60)

    print(f"\n{'=' * 70}")
    print(f"  Results: {passed} passed, {failed} failed out of {len(TEST_CASES)} tests")
    print("=" * 70)
    return failed == 0


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
