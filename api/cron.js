const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { dispatchAllNotifications } = require('../utils/notifications');

const SNAPSHOT_FILE = process.env.VERCEL ? '/tmp/snapshot.json' : path.join(__dirname, '../snapshot.json');

// Helper to load snapshot
function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { knownResults: {}, activeAlerts: [] };
}

// Helper to save snapshot
function saveSnapshot(data) {
  try {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {}
}

// Safely resolve executablePath for Vercel (Linux) vs Local Dev (Windows/Mac)
async function getExecutablePath() {
  if (!process.env.VERCEL && process.platform === 'win32') {
    const winPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of winPaths) {
      if (p && fs.existsSync(p)) return p;
    }
  }

  try {
    return await chromium.executablePath();
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  console.log('[Vercel Cron] Starting ResultWatcher scan execution...');
  let browser = null;

  try {
    const executablePath = await getExecutablePath();
    console.log(`[Vercel Cron] Launching Chromium (path: ${executablePath || 'auto'})...`);

    const launchArgs = {
      args: process.env.VERCEL ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: process.env.VERCEL ? chromium.defaultViewport : { width: 1280, height: 800 },
      executablePath: executablePath || (await chromium.executablePath()),
      headless: true
    };

    browser = await puppeteer.launch(launchArgs);

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(25000);

    const targetUrl = 'https://mbmiums.in/Results/ExamResultDeclare.aspx';
    console.log(`[Vercel Cron] Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // Step 1: Click (II)Odd Semester Examination Results 2025-26 (LinkButton8)
    console.log('[Vercel Cron] Clicking LinkButton8 ((II)Odd Semester Examination Results 2025-26)...');
    const clickResult = await page.evaluate(() => {
      const link = document.querySelector('#LinkButton8') || 
                   Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Odd Semester Examination Results 2025-26'));
      if (link) {
        link.click();
        return { clicked: true, text: link.textContent.trim() };
      }
      return { clicked: false };
    });

    if (clickResult.clicked) {
      console.log(`[Vercel Cron] Clicked link "${clickResult.text}". Waiting for UpdatePanel render...`);
      await new Promise(r => setTimeout(r, 3000));
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    }

    // Step 2: Extract all result links
    const extracted = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(l => ({
          text: l.textContent.replace(/\s+/g, ' ').trim(),
          href: l.href || '#',
          id: l.id || null
        }))
        .filter(l => l.text.length > 3 && !l.text.toLowerCase().includes('home') && l.text.toUpperCase() !== 'BACK');
    });

    console.log(`[Vercel Cron] Extracted ${extracted.length} result links from page.`);

    // Step 3: Compare with Snapshot
    const snapshot = loadSnapshot();
    const isFirstRun = Object.keys(snapshot.knownResults).length === 0;
    const newItems = [];

    for (const item of extracted) {
      const key = (item.id ? item.id + '_' : '') + item.text.toLowerCase();
      if (!snapshot.knownResults[key]) {
        snapshot.knownResults[key] = {
          key,
          title: item.text,
          href: item.href,
          discoveredAt: new Date().toISOString()
        };

        if (!isFirstRun) {
          newItems.push({
            title: item.text,
            href: item.href,
            key
          });
        }
      }
    }

    saveSnapshot(snapshot);

    // Step 4: Dispatch Alerts if new results found
    let alertDispatchResults = null;
    if (newItems.length > 0) {
      console.log(`[Vercel Cron] 🚨 ALARM TRIGGERED! ${newItems.length} NEW RESULT(S) DETECTED!`);
      alertDispatchResults = await dispatchAllNotifications(newItems);
    } else {
      console.log('[Vercel Cron] Scan complete. No new results detected.');
    }

    if (res && res.status) {
      return res.status(200).json({
        success: true,
        timestamp: new Date().toISOString(),
        extractedCount: extracted.length,
        knownTotal: Object.keys(snapshot.knownResults).length,
        newResultsFound: newItems.length,
        newResults: newItems,
        alertDispatchResults
      });
    }

  } catch (err) {
    console.error('[Vercel Cron] Execution Error:', err.message);
    if (res && res.status) {
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};
