const nodemailer = require('nodemailer');
const axios = require('axios');

/**
 * Send Email Notification via Nodemailer (Mail Hook)
 */
async function sendMailNotification(newResults, config = {}) {
  const host = config.smtpHost || process.env.SMTP_HOST;
  const port = config.smtpPort || process.env.SMTP_PORT || 587;
  const user = config.smtpUser || process.env.SMTP_USER;
  const pass = config.smtpPass || process.env.SMTP_PASS;
  const to = config.notificationEmail || process.env.NOTIFICATION_EMAIL || user;

  if (!host || !user || !pass || !to) {
    console.log('[Mail Hook] Missing SMTP or recipient credentials. Email notification skipped.');
    return { success: false, message: 'SMTP credentials missing' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port),
    secure: parseInt(port) === 465,
    auth: { user, pass }
  });

  const count = newResults.length;
  const subject = `🚨 [ResultWatcher] ${count} NEW MBM EXAM RESULT(S) DECLARED!`;

  const resultsHtml = newResults.map(r => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 12px; font-weight: bold; color: #1e293b;">${r.title}</td>
      <td style="padding: 12px;"><a href="${r.href}" style="background-color: #2563eb; color: #ffffff; padding: 6px 12px; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: bold;">Open Result</a></td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #1e3a8a, #3b82f6); color: #ffffff; padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 22px;">🚨 MBM Result Portal Alert</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">${count} New Result(s) Released on mbmiums.in</p>
      </div>
      <div style="padding: 24px;">
        <p style="color: #334155; font-size: 15px;">The automated ResultWatcher detected newly published results matching your criteria:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <thead>
            <tr style="background-color: #f1f5f9; text-align: left; color: #475569;">
              <th style="padding: 10px 12px;">Result Name</th>
              <th style="padding: 10px 12px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${resultsHtml}
          </tbody>
        </table>
        <div style="text-align: center; margin-top: 24px;">
          <a href="https://mbmiums.in/Results/ExamResultDeclare.aspx" style="background-color: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Go to Official MBM Portal</a>
        </div>
      </div>
      <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
        ResultWatcher Serverless Alert Engine &bull; MBM University
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"ResultWatcher Alert" <${user}>`,
      to,
      subject,
      html
    });
    console.log(`[Mail Hook] Email sent successfully to ${to} (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Mail Hook] Error sending email:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send Telegram Bot Notification
 */
async function sendTelegramNotification(newResults, config = {}) {
  const botToken = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return { success: false, message: 'Telegram credentials missing' };
  }

  const count = newResults.length;
  let text = `🚨 *MBM RESULT ALERT!*\n\n*${count} New Result(s) Discovered:*\n\n`;
  newResults.forEach((r, idx) => {
    text += `${idx + 1}. *${r.title.replace(/\*/g, '')}*\n`;
  });
  text += `\n🔗 [Open MBM Portal](https://mbmiums.in/Results/ExamResultDeclare.aspx)`;

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    });
    console.log('[Telegram Hook] Message sent successfully');
    return { success: true };
  } catch (err) {
    console.error('[Telegram Hook] Error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send Discord Webhook Notification
 */
async function sendDiscordNotification(newResults, config = {}) {
  const webhookUrl = config.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    return { success: false, message: 'Discord webhook URL missing' };
  }

  const count = newResults.length;
  const fields = newResults.slice(0, 10).map((r, i) => ({
    name: `Result #${i + 1}`,
    value: `**${r.title}**`,
    inline: false
  }));

  const payload = {
    username: 'ResultWatcher Bot',
    avatar_url: 'https://cdn-icons-png.flaticon.com/512/3524/3524388.png',
    embeds: [
      {
        title: `🚨 ${count} NEW MBM EXAM RESULT(S) DECLARED!`,
        description: 'New examination results are now live on the MBM University portal.',
        url: 'https://mbmiums.in/Results/ExamResultDeclare.aspx',
        color: 15158332, // Amber / Red highlight
        fields,
        footer: { text: 'ResultWatcher Vercel Cron Engine' },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    await axios.post(webhookUrl, payload);
    console.log('[Discord Hook] Embed sent successfully');
    return { success: true };
  } catch (err) {
    console.error('[Discord Hook] Error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Master Notification Dispatcher
 */
async function dispatchAllNotifications(newResults, config = {}) {
  const results = {};
  results.mail = await sendMailNotification(newResults, config);
  results.telegram = await sendTelegramNotification(newResults, config);
  results.discord = await sendDiscordNotification(newResults, config);
  return results;
}

module.exports = {
  sendMailNotification,
  sendTelegramNotification,
  sendDiscordNotification,
  dispatchAllNotifications
};
