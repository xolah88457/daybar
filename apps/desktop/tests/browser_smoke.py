"""Browser-only smoke; run against a static export, never a real data folder.

with_server.py --server 'python3 -m http.server 3107 --bind 127.0.0.1 --directory apps/desktop/out' \
  --port 3107 -- python apps/desktop/tests/browser_smoke.py
Requires Playwright and its Chromium browser outside the pnpm workspace.
"""
import re
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    requests = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))
    page.on("dialog", lambda dialog: dialog.accept())
    page.add_init_script("Storage.prototype.setItem = () => { throw Error('User data must stay in memory'); };")
    page.goto("http://127.0.0.1:3107")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Here & now.")).to_be_visible()
    expect(page.get_by_role("checkbox", name=re.compile("Read a chapter"))).to_be_visible()
    shell = page.locator(".app-shell")
    night_background = shell.evaluate("el => getComputedStyle(el).backgroundColor")
    page.get_by_role("button", name="Switch to day appearance").click()
    expect(shell).to_have_attribute("data-theme", "day")
    assert "--background" not in (shell.get_attribute("style") or "")
    day_background = shell.evaluate("el => getComputedStyle(el).backgroundColor")
    assert day_background != night_background, (night_background, day_background)
    page.get_by_role("button", name="Switch to night appearance").click()
    expect(shell).to_have_attribute("data-theme", "night")
    page.screenshot(path="/tmp/daybar-ui-today.png", full_page=True)

    def navigate(name):
        page.get_by_role("navigation", name="Modules").get_by_role("button", name=re.compile(name)).click()

    navigate("Habits")
    page.get_by_label("Edit habit day").fill("2026-11-14")
    task = page.get_by_role("checkbox", name=re.compile("Read a chapter"))
    previous = task.is_checked()
    task.click()
    expect(task).to_be_checked(checked=not previous)
    navigate("Focus")
    page.get_by_role("button", name="25 min ↗", exact=True).click()
    expect(page.get_by_role("timer")).not_to_have_text("0:00")
    page.get_by_role("button", name=re.compile("Stop & count whole minutes")).click()
    expect(page.get_by_role("status")).to_contain_text("nothing was counted")
    navigate("Settings")
    page.locator("summary").filter(has_text=re.compile("^Focus")).click()
    page.get_by_label(re.compile("Block Minutes")).fill("0")
    page.get_by_role("button", name="Save shared settings ↗").click()
    expect(page.locator(".form-error[role=alert]")).to_contain_text("focus.blockMinutes")
    page.get_by_label(re.compile("Block Minutes")).fill("30")
    page.get_by_role("button", name="Save shared settings ↗").click()
    expect(page.get_by_role("status")).to_have_text(re.compile("Saved"))
    page.get_by_role("textbox", name="New name for Read a chapter").fill("Read every day")
    page.get_by_role("button", name="Rename…", exact=True).first.click()
    expect(page.locator(".notice[role=alert]")).to_contain_text("changed outside this editor")
    navigate("Habits")
    expect(page.get_by_role("checkbox", name=re.compile("Read every day"))).to_be_visible()
    navigate("Sleep")
    page.get_by_role("button", name="Woke just now ↗").click()
    page.get_by_role("button", name=re.compile("Start plan today")).click()
    expect(page.get_by_role("button", name="Stop plan", exact=True)).to_be_visible()
    page.get_by_role("button", name=re.compile("Clear all sleep data")).click()
    expect(page.get_by_text("No sleep entries yet.")).to_be_visible()
    navigate("Countdown")
    expect(page.get_by_role("group", name="Countdown days")).to_be_visible()
    navigate("Today")
    for width, height in [(1440, 900), (1280, 800), (1280, 1000), (900, 1600), (600, 1000), (375, 812)]:
        page.set_viewport_size({"width": width, "height": height})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow at {width}x{height}"
        if width == 900:
            expect(page.locator(".dashboard-grid")).to_have_css("display", "flex")
        if width == 1440:
            expect(page.locator(".dashboard-grid")).to_have_css("grid-template-columns", re.compile("\\S+ \\S+"))
    page.set_viewport_size({"width": 900, "height": 1600})
    page.screenshot(path="/tmp/daybar-ui-mobile.png", full_page=True)
    for key, title in [("1", "Here & now."), ("2", "Countdown"), ("3", "Habits"), ("4", "Focus"), ("5", "Sleep"), ("6", "Settings")]:
        page.keyboard.press(key)
        expect(page.get_by_role("heading", level=1, name=title)).to_be_visible()
    assert page.evaluate("localStorage.length") == 0
    assert not errors, errors
    assert all(url.startswith("http://127.0.0.1:3107/") for url in requests), requests
    print("Browser smoke passed: all six screens, past task edit, focus start/stop, validated settings, history rename, sleep plan/clear, 375–1280px, no runtime errors or external requests.")
    browser.close()
