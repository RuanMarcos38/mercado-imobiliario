import asyncio
import os
import json
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path("/tmp/browser/check_login/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

async def test_security_isolation():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        print("Navigating to auth page...")
        await page.goto("http://localhost:8080/auth", wait_until="networkidle")

        print("Testing multiple failed attempts (Security Alert Check)...")
        for i in range(3):
            await page.get_by_label("E-mail").fill("nonexistent@user.com")
            await page.get_by_label("Senha").fill("wrongpassword")
            await page.get_by_role("button", name="Entrar no Painel").click()
            await asyncio.sleep(2)

        await page.screenshot(path=str(SCREENSHOTS / "security_alert_test.png"))
        
        # Check for error toast about multiple attempts
        toast = page.locator("ol[dir=ltr]")
        if await toast.count() > 0:
            print("Alert detected:", await toast.inner_text())
        else:
            print("No alert detected.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(test_security_isolation())
