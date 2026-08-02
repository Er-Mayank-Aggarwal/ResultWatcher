const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SNAPSHOT_FILE = process.env.VERCEL ? '/tmp/snapshot.json' : path.join(__dirname, '../snapshot.json');

module.exports = async function handler(req, res) {
  let knownResults = {};
  let activeAlerts = [];
  let logs = [];

  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const data = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
      knownResults = data.knownResults || {};
      activeAlerts = data.activeAlerts || [];
      logs = data.logs || [];
    }
  } catch (e) {}

  return res.status(200).json({
    platform: 'Vercel Serverless',
    status: 'active',
    knownCount: Object.keys(knownResults).length,
    knownResultsList: Object.values(knownResults),
    activeAlerts,
    logs: logs.slice(0, 30),
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      fromNumber: process.env.TWILIO_FROM_NUMBER || '+15717245832',
      toNumber: process.env.TWILIO_TO_NUMBER || '+916367468738',
      hasToken: !!process.env.TWILIO_AUTH_TOKEN
    }
  });
};
