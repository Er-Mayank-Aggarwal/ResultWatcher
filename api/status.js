const fs = require('fs');
const path = require('path');

const SNAPSHOT_FILE = process.env.VERCEL ? '/tmp/snapshot.json' : path.join(__dirname, '../snapshot.json');

module.exports = async function handler(req, res) {
  let knownResults = {};
  let activeAlerts = [];

  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const data = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
      knownResults = data.knownResults || {};
      activeAlerts = data.activeAlerts || [];
    }
  } catch (e) {}

  return res.status(200).json({
    platform: 'Vercel Serverless',
    status: 'active',
    knownCount: Object.keys(knownResults).length,
    knownResultsList: Object.values(knownResults),
    activeAlerts,
    env: {
      hasSmtp: !!process.env.SMTP_HOST,
      hasTelegram: !!process.env.TELEGRAM_BOT_TOKEN,
      hasDiscord: !!process.env.DISCORD_WEBHOOK_URL
    }
  });
};
