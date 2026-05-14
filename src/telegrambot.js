// src/telegrambot.js — обработчик команд Telegram бота с настройками типов уведомлений

const TelegramBot = require('node-telegram-bot-api');
const telegram = require('./telegram');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
console.log('[Telegram Bot] Запущен с polling...');

// ── /start ──
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  telegram.addSubscriber(chatId);

  bot.sendMessage(chatId,
    `👋 Привет, ${msg.from.first_name}!\n\n` +
    `Ты подписан на уведомления о голосовых каналах Discord сервера Gray Squad.\n` +
    `По умолчанию включены все типы: заход, выход, переход.\n\n` +
    `Команды:\n` +
    `/status — статистика\n` +
    `/settings — настроить типы уведомлений\n` +
    `/stop — отписаться`,
    { parse_mode: 'HTML' }
  );
});

// ── /stop ──
bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  telegram.removeSubscriber(chatId);
  bot.sendMessage(chatId, '❌ Ты отписался от уведомлений. Чтобы снова подписаться, отправь /start');
});

// ── /status ──
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const total = telegram.getSubscriberCount();
  const joinActive = telegram.getActiveCountForType('join');
  const leaveActive = telegram.getActiveCountForType('leave');
  const switchActive = telegram.getActiveCountForType('switch');

  await bot.sendMessage(chatId,
    `📊 <b>Статистика подписчиков</b>\n` +
    `Всего: ${total}\n\n` +
    `🔊 Вход: ${joinActive} чел.\n` +
    `🔇 Выход: ${leaveActive} чел.\n` +
    `🔄 Переход: ${switchActive} чел.`,
    { parse_mode: 'HTML' }
  );
});

// ── /settings (Reply-кнопки для каждого типа) ──
bot.onText(/\/settings/, async (msg) => {
  const chatId = msg.chat.id;
  const settings = telegram.getSubscriberSettings(chatId);

  if (!settings) {
    return bot.sendMessage(chatId, 'Вы не подписаны. Отправьте /start чтобы начать.');
  }

  // Формируем Reply-клавиатуру с текущим состоянием
  const keyboard = {
    keyboard: [
      [{ text: settings.join ? '🔊 Вход: ВКЛ' : '🔊 Вход: ВЫКЛ' }],
      [{ text: settings.leave ? '🔇 Выход: ВКЛ' : '🔇 Выход: ВЫКЛ' }],
      [{ text: settings.switch ? '🔄 Переход: ВКЛ' : '🔄 Переход: ВЫКЛ' }],
      [{ text: '📊 Статус' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };

  await bot.sendMessage(chatId,
    `⚙️ <b>Настройки уведомлений</b>\n\n` +
    `Выберите тип, чтобы включить/выключить:\n` +
    `🔊 Вход — когда отслеживаемый пользователь заходит в голосовой канал\n` +
    `🔇 Выход — когда выходит\n` +
    `🔄 Переход — когда переключается между каналами`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    }
  );
});

// ── Обработка Reply-кнопок (обычные сообщения) ──
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  // Проверяем, подписан ли пользователь
  const settings = telegram.getSubscriberSettings(chatId);
  if (!settings) {
    if (text.startsWith('🔊') || text.startsWith('🔇') || text.startsWith('🔄')) {
      return bot.sendMessage(chatId, 'Вы не подписаны. Отправьте /start');
    }
    return;
  }

  let type;
  if (text.startsWith('🔊 Вход')) type = 'join';
  else if (text.startsWith('🔇 Выход')) type = 'leave';
  else if (text.startsWith('🔄 Переход')) type = 'switch';
  else if (text === '📊 Статус') {
    // быстрый вызов /status
    const total = telegram.getSubscriberCount();
    const joinA = telegram.getActiveCountForType('join');
    const leaveA = telegram.getActiveCountForType('leave');
    const switchA = telegram.getActiveCountForType('switch');
    return bot.sendMessage(chatId,
      `📊 <b>Статистика подписчиков</b>\nВсего: ${total}\n🔊 Вход: ${joinA}\n🔇 Выход: ${leaveA}\n🔄 Переход: ${switchA}`,
      { parse_mode: 'HTML' }
    );
  }

  if (!type) return; // не наша кнопка

  // Переключаем флаг
  const newValue = !settings[type];
  telegram.setSubscriberSetting(chatId, type, newValue);

  // Обновляем settings после изменения
  const updated = telegram.getSubscriberSettings(chatId);

  // Формируем обновлённую клавиатуру
  const keyboard = {
    keyboard: [
      [{ text: updated.join ? '🔊 Вход: ВКЛ' : '🔊 Вход: ВЫКЛ' }],
      [{ text: updated.leave ? '🔇 Выход: ВКЛ' : '🔇 Выход: ВЫКЛ' }],
      [{ text: updated.switch ? '🔄 Переход: ВКЛ' : '🔄 Переход: ВЫКЛ' }],
      [{ text: '📊 Статус' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };

  const typeNames = {
    join: 'Вход',
    leave: 'Выход',
    switch: 'Переход',
  };

  await bot.sendMessage(chatId,
    `✅ Уведомления о <b>${typeNames[type]}</b>: ${newValue ? 'ВКЛючены' : 'ВЫКЛючены'}.`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    }
  );
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  console.error('[Telegram Bot] Polling error:', error.message);
});

module.exports = bot;