// heygen.js
// Run with: node heygen.js

const { chromium } = require("playwright");
const fs = require("fs");

const STORAGE_FILE = "heygen-storage.json";

// Demo credentials
const EMAIL = "getawaysatravel@gmail.com";
const PASSWORD = "H5m@heygeN";

(async () => {
  const browser = await chromium.launch({ headless: false }); // show browser while testing
  let context;

  try {
    if (fs.existsSync(STORAGE_FILE)) {
      console.log("💾 Using saved session...");
      context = await browser.newContext({ storageState: STORAGE_FILE });
    } else {
      console.log("🔑 Logging in with demo account...");
      context = await browser.newContext();
      const page = await context.newPage();

      await page.goto("https://app.heygen.com/login", { waitUntil: "domcontentloaded" });

      // Step 1: Enter email + Continue
      await page.getByPlaceholder("Enter email").fill(EMAIL);
      await page.getByRole("button", { name: "Continue" }).click();

      // Step 2: Enter password + Log in
      await page.getByPlaceholder("Enter password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();

      // Wait for dashboard or main page after login
      await page.waitForLoadState("domcontentloaded", { timeout: 20000 });

      console.log("✅ Login successful, saving session...");
      await context.storageState({ path: STORAGE_FILE });
    }

    // Use logged-in session
    const page = await context.newPage();
    console.log("🌍 Opening dashboard...");
    await page.goto("https://app.heygen.com/dashboard", { waitUntil: "domcontentloaded" });

    console.log("📍 Current URL:", page.url());
    await page.screenshot({ path: "heygen_dashboard.png", fullPage: true });
    console.log("📸 Saved screenshot: heygen_dashboard.png");

  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await browser.close();
  }
})();
