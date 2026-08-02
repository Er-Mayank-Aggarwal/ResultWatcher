const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
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

// Resolve Chromium executablePath for Vercel Lambda (Linux) vs Local Dev (Windows/Mac)
async function getExecutablePath() {
  if (process.env.VERCEL) {
    // Hosted Chromium pack URL containing all shared libraries (libnss3.so, etc.) for Vercel
    return await chromium.executablePath('https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar');
  }

  if (process.platform === 'win32') {
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

// Fallback Scraper using Axios HTTP
async function fetchResultsViaHttp() {
  console.log('[Vercel Cron] Running HTTP Fallback Scraper...');
  const declareUrl = 'https://mbmiums.in/Results/ExamResultDeclare.aspx';
  const examResultUrl = 'https://mbmiums.in/Results/ExamResult.aspx';
  const raw = [];

  try {
    const res = await axios.get(declareUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(res.data);
    $('a').each((i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href') || '#';
      const id = $(el).attr('id') || null;
      if (text.length > 3 && !text.toLowerCase().includes('home') && text.toUpperCase() !== 'BACK') {
        raw.push({ text, href, id });
      }
    });
  } catch (e) {
    console.error('[HTTP Fallback Error]:', e.message);
  }

  if (raw.length === 0) {
    try {
      const res2 = await axios.get(examResultUrl, { timeout: 10000 });
      const $2 = cheerio.load(res2.data);
      $2('a').each((i, el) => {
        const text = $2(el).text().trim();
        const href = $2(el).attr('href') || '#';
        const id = $2(el).attr('id') || null;
        if (text.length > 3) raw.push({ text, href, id });
      });
    } catch (e2) {}
  }

  return raw;
}

module.exports = async function handler(req, res) {
  console.log('[Vercel Cron] Starting ResultWatcher scan execution...');
  let browser = null;
  let extracted = [];

  try {
    const executablePath = await getExecutablePath();
    console.log(`[Vercel Cron] Launching Chromium...`);

    const launchArgs = {
      args: process.env.VERCEL ? [...chromium.args, '--single-process', '--no-zygote'] : ['--no-sandbox', '--disable-setuid-sandbox'],
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

    // Click LinkButton8 ((II)Odd Semester Examination Results 2025-26)
    console.log('[Vercel Cron] Clicking LinkButton8...');
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
      console.log(`[Vercel Cron] Clicked "${clickResult.text}". Waiting for UpdatePanel...`);
      await new Promise(r => setTimeout(r, 3000));
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    }

    // Extract all result links
    extracted = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(l => ({
          text: l.textContent.replace(/\s+/g, ' ').trim(),
          href: l.href || '#',
          id: l.id || null
        }))
        .filter(l => l.text.length > 3 && !l.text.toLowerCase().includes('home') && l.text.toUpperCase() !== 'BACK');
    });

    console.log(`[Vercel Cron] Puppeteer extracted ${extracted.length} result links.`);

  } catch (err) {
    console.error(`[Vercel Cron Browser Error]: ${err.message}. Switching to HTTP fallback...`);
    extracted = await fetchResultsViaHttp();
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // Compare with Snapshot
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

  // Dispatch Alerts if new results found
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
      knownResultsList: Object.values(snapshot.knownResults),
      newResultsFound: newItems.length,
      newResults: newItems,
      alertDispatchResults
    });
  }
};
