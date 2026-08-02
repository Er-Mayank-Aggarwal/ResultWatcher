const { sendTestTwilioSms } = require('../utils/twilio');
require('dotenv').config();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  const config = {
    accountSid: body.accountSid || process.env.TWILIO_ACCOUNT_SID || '',
    authToken: body.authToken || process.env.TWILIO_AUTH_TOKEN,
    fromNumber: body.fromNumber || process.env.TWILIO_FROM_NUMBER || '+15717245832',
    toNumber: body.toNumber || process.env.TWILIO_TO_NUMBER || '+916367468738'
  };

  try {
    const result = await sendTestTwilioSms(config);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
