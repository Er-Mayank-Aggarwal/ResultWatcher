const { dispatchAllNotifications } = require('../utils/notifications');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { smtpHost, smtpPort, smtpUser, smtpPass, notificationEmail, telegramBotToken, telegramChatId, discordWebhookUrl } = req.body;

  const mockNewResults = [
    {
      title: 'B.E.(CBCS) ENGINEERING IIIrd SEM ( COMPUTER SCIENCE & ENGINEERING(CSE) ) Examination Result (TEST ALERT)',
      href: 'https://mbmiums.in/Results/ExamResultDeclare.aspx',
      key: 'test_result_cse'
    }
  ];

  const config = {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    notificationEmail,
    telegramBotToken,
    telegramChatId,
    discordWebhookUrl
  };

  try {
    const dispatchResults = await dispatchAllNotifications(mockNewResults, config);
    return res.status(200).json({
      success: true,
      message: 'Notification test executed',
      results: dispatchResults
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
