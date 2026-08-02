const { sendTestTwilioSms } = require('../utils/twilio');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accountSid, authToken, fromNumber, toNumber } = req.body;

  try {
    const result = await sendTestTwilioSms({ accountSid, authToken, fromNumber, toNumber });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
