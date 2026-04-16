"""
Responsive Design Testing for MemoryWeaver
Tests various viewport sizes and checks for console errors
"""
from playwright.sync_api import sync_playwright
import json

def test_responsive_design():
    results = {
        "viewport_tests": [],
        "console_errors": [],
        "issues": []
    }

    viewports = [
        {"name": "Desktop 1920x1080", "width": 1920, "height": 1080},
        {"name": "Laptop 1366x768", "width": 1366, "height": 768},
        {"name": "Tablet 1024x768", "width": 1024, "height": 768},
        {"name": "Tablet 900x600", "width": 900, "height": 600},
        {"name": "Mobile 768x1024", "width": 768, "height": 1024},
        {"name": "Mobile 480x320", "width": 480, "height": 320},
        {"name": "Mobile 375x667", "width": 375, "height": 667},
        {"name": "Mobile 360x640", "width": 360, "height": 640},
    ]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for vp in viewports:
            page = browser.new_page(viewport={"width": vp["width"], "height": vp["height"]})

            # Capture console errors
            errors = []
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

            try:
                page.goto("http://localhost:5000", timeout=10000)
                page.wait_for_load_state("networkidle", timeout=10000)

                # Check page title
                title = page.title()

                # Check for visible elements
                sidebar = page.locator(".sidebar").is_visible()
                header = page.locator(".header").is_visible()
                main_content = page.locator(".main-content").is_visible()

                # Check mobile menu button visibility
                mobile_menu_btn = page.locator(".mobile-menu-btn")
                mobile_menu_visible = mobile_menu_btn.is_visible() if mobile_menu_btn.count() > 0 else False

                # Check for layout overflow issues
                body_overflow = page.evaluate("document.body.scrollWidth > window.innerWidth")

                test_result = {
                    "viewport": vp["name"],
                    "width": vp["width"],
                    "height": vp["height"],
                    "title": title,
                    "sidebar_visible": sidebar,
                    "header_visible": header,
                    "main_content_visible": main_content,
                    "mobile_menu_btn_visible": mobile_menu_visible,
                    "horizontal_overflow": body_overflow,
                    "console_errors": errors
                }

                results["viewport_tests"].append(test_result)

                # Log issues
                if body_overflow:
                    results["issues"].append(f"{vp['name']}: Horizontal overflow detected")
                if errors:
                    results["issues"].append(f"{vp['name']}: Console errors - {errors}")
                if not sidebar and vp["width"] > 768:
                    results["issues"].append(f"{vp['name']}: Sidebar not visible on desktop")

                print(f"✓ {vp['name']}: overflow={body_overflow}, mobile_menu={mobile_menu_visible}")

            except Exception as e:
                results["issues"].append(f"{vp['name']}: Error - {str(e)}")
                print(f"✗ {vp['name']}: {e}")

            page.close()

        browser.close()

    # Save results
    with open("test_responsive_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("\n" + "="*50)
    print("RESPONSIVE TEST SUMMARY")
    print("="*50)
    print(f"Viewports tested: {len(results['viewport_tests'])}")
    print(f"Issues found: {len(results['issues'])}")

    if results["issues"]:
        print("\nIssues:")
        for issue in results["issues"]:
            print(f"  - {issue}")

    return results

if __name__ == "__main__":
    test_responsive_design()
