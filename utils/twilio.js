const axios = require('axios');
require('dotenv').config();

const DEFAULT_FROM = '+15717245832';
const DEFAULT_TO = '+916367468738';

/**
 * Send Twilio SMS alert for new MBM exam results
 */
async function sendTwilioSms(newResults, config = {}) {
  const accountSid = config.accountSid || process.env.TWILIO_ACCOUNT_SID;
  const authToken = config.authToken || process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = config.fromNumber || process.env.TWILIO_FROM_NUMBER || DEFAULT_FROM;
  const toNumber = config.toNumber || process.env.TWILIO_TO_NUMBER || DEFAULT_TO;

  if (!accountSid || !authToken) {
    console.log('[Twilio SMS] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing in environment. SMS notification skipped.');
    return { success: false, message: 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing in Vercel Environment Variables' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const count = newResults.length;
  
  let messageBody = `🚨 MBM RESULT ALERT!\n${count} New Result(s) Released on mbmiums.in:\n\n`;
  newResults.slice(0, 3).forEach((r, idx) => {
    messageBody += `${idx + 1}. ${r.title}\n`;
  });
  if (count > 3) {
    messageBody += `+ ${count - 3} more results.\n`;
  }
  messageBody += `\nCheck portal: https://mbmiums.in`;

  const formData = new URLSearchParams();
  formData.append('To', toNumber);
  formData.append('From', fromNumber);
  formData.append('Body', messageBody);

  try {
    const res = await axios.post(url, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      auth: {
        username: accountSid,
        password: authToken
      }
    });

    console.log(`[Twilio SMS] SMS sent successfully to ${toNumber} (SID: ${res.data.sid})`);
    return { success: true, sid: res.data.sid, status: res.data.status };
  } catch (err) {
    const errMsg = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[Twilio SMS] Error sending SMS:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Send Test Twilio SMS
 */
async function sendTestTwilioSms(config = {}) {
  const mockResult = [
    {
      title: 'B.E.(CBCS) ENGINEERING IIIrd SEM ( COMPUTER SCIENCE & ENGINEERING(CSE) ) Examination Result (TEST SMS)',
      href: 'https://mbmiums.in/Results/ExamResultDeclare.aspx'
    }
  ];
  return await sendTwilioSms(mockResult, config);
}

module.exports = {
  sendTwilioSms,
  sendTestTwilioSms,
  DEFAULT_FROM,
  DEFAULT_TO
};
