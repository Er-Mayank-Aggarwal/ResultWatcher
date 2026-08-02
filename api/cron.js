const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { sendTwilioSms } = require('../utils/twilio');

const SNAPSHOT_FILE = process.env.VERCEL ? '/tmp/snapshot.json' : path.join(__dirname, '../snapshot.json');

// Helper to load snapshot
function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { knownResults: {}, activeAlerts: [], logs: [] };
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
    try {
      chromium.setGraphicsMode = false;
      return await chromium.executablePath();
    } catch (e) {
      return null;
    }
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
  const snapshot = loadSnapshot();
  snapshot.logs = snapshot.logs || [];

  const addLog = (msg, type = 'info') => {
    snapshot.logs.unshift({
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      message: msg,
      type
    });
    if (snapshot.logs.length > 50) snapshot.logs.pop();
  };

  addLog('Starting ResultWatcher scan on mbmiums.in...', 'info');

  try {
    const executablePath = await getExecutablePath();
    if (!executablePath && process.env.VERCEL) {
      throw new Error('Using optimized HTTP scraper engine');
    }

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
      addLog(`Clicked "${clickResult.text}". Waiting for UpdatePanel render...`, 'success');
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

    addLog(`Extracted ${extracted.length} result links.`, 'success');

  } catch (err) {
    if (!err.message.includes('optimized HTTP')) {
      console.log(`[Vercel Cron Engine Note]: ${err.message}. Running HTTP scraper...`);
    }
    extracted = await fetchResultsViaHttp();
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // Compare with Snapshot
  const isFirstRun = Object.keys(snapshot.knownResults).length === 0;
  const newItems = [];

  for (const item of extracted) {
    const key = (item.id ? item.id + '_' : '') + (item.text || '').toLowerCase();
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

  // Dispatch Alerts if new results found
  let alertDispatchResults = null;
  if (newItems.length > 0) {
    addLog(`🚨 ALARM TRIGGERED! ${newItems.length} NEW RESULT(S) DETECTED!`, 'alert');
    alertDispatchResults = await sendTwilioSms(newItems);
  } else {
    addLog(`Scan complete. No new results detected (${extracted.length} links checked).`, 'info');
  }

  saveSnapshot(snapshot);

  const formattedList = extracted.map(i => ({
    title: i.text || i.title || 'Exam Result',
    href: i.href || '#',
    key: (i.id ? i.id + '_' : '') + (i.text || '').toLowerCase()
  }));

  if (res && res.status) {
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      extractedCount: extracted.length,
      knownTotal: formattedList.length,
      knownResultsList: formattedList,
      newResultsFound: newItems.length,
      newResults: newItems,
      alertDispatchResults,
      logs: snapshot.logs
    });
  }
};
