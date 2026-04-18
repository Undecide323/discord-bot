// src/deploy-commands.js
const { REST, Routes } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const commands = [
  {
    name: 'profile',
    description: 'Показать профиль пользователя',
    options: [
      {
        name: 'user',
        description: 'Пользователь',
        type: 6, // USER type
        required: false,
      },
    ],
  },
  {
    name: 'rank',
    description: 'Показать текущий ELO ранг',
    options: [
      {
        name: 'user',
        description: 'Пользователь',
        type: 6,
        required: false,
      },
    ],
  },
  {
    name: 'top',
    description: 'Топ 10 игроков',
    options: [
      {
        name: 'type',
        description: 'Тип рейтинга',
        type: 3, // STRING
        required: false,
        choices: [
          { name: 'ELO', value: 'elo' },
          { name: 'Уровень', value: 'level' },
          { name: 'Монеты', value: 'coins' },
          { name: 'Голосовые минуты', value: 'voice' },
        ],
      },
    ],
  },
  {
    name: 'daily',
    description: 'Получить ежедневный бонус',
  },
  {
    name: 'sync',
    description: 'Синхронизировать участников (только админ)',
  },
  {
    name: 'warn',
    description: 'Выдать варн пользователю (только админ)',
    options: [
      { name: 'user', description: 'Пользователь', type: 6, required: true },
      { name: 'reason', description: 'Причина', type: 3, required: false },
    ],
  },
  {
    name: 'unwarn',
    description: 'Снять последний варн (только админ)',
    options: [
      { name: 'user', description: 'Пользователь', type: 6, required: true },
    ],
  },
  {
    name: 'give',
    description: 'Выдать ресурс (только админ)',
    options: [
      { name: 'user', description: 'Пользователь', type: 6, required: true },
      { name: 'type', description: 'Тип ресурса', type: 3, required: true, choices: [
        { name: 'XP', value: 'xp' },
        { name: 'Монеты', value: 'coins' },
        { name: 'ELO', value: 'elo' },
      ]},
      { name: 'amount', description: 'Количество', type: 4, required: true }, // INTEGER
    ],
  },
  {
    name: 'achiev',
    description: 'Выдать ачивку (только админ)',
    options: [
      { name: 'user', description: 'Пользователь', type: 6, required: true },
      { name: 'id', description: 'ID ачивки', type: 3, required: true },
    ],
  },
  {
    name: 'help',
    description: 'Список команд',
  },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🔄 Регистрация слеш-команд...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Слеш-команды зарегистрированы!');
  } catch (error) {
    console.error(error);
  }
})();