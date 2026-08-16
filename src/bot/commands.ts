import { Telegraf } from 'telegraf';

type BotCommandEntry = { command: string; description: string };

// 呢個 list 會自動註冊去 Telegram（setMyCommands），唔使 BotFather。
// 呢度就係 bot command 嘅單一來源（source of truth）。
const BOT_COMMANDS: BotCommandEntry[] = [
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Bot health check (AI / VPN / Gemini / DB)' },
  { command: 'quit', description: 'Admin only: make bot leave the group' },
  { command: 'j', description: 'Track your Jed day' },
  { command: 'users', description: 'Day count leaderboard' },
  { command: 'me', description: 'Show your day count' },
  { command: 'from', description: 'Calculate time from a date (DD-MM-YYYY)' },
  { command: 'weather', description: 'Get weather forecast' },
  { command: 'marksix', description: 'Get Mark Six reminder' },
  {
    command: 'marksix_remind',
    description: 'Enable/disable Mark Six reminder',
  },
  { command: 'jp', description: 'Random JLPT vocabulary' },
  { command: 'draw', description: 'Generate an image using AI' },
  {
    command: 'transportation',
    description:
      ' Suggest transportation options to user in order to reach the destination.',
  },
];

/**
 * 自動註冊 bot commands（setMyCommands）——唔使 BotFather。
 * 每次 startup call 一次就得；失敗都唔會影響 bot 運作。
 */
async function registerBotCommands(bot: Telegraf): Promise<void> {
  try {
    await bot.telegram.setMyCommands(BOT_COMMANDS);
    console.log(`✅ 已註冊 ${BOT_COMMANDS.length} 個 bot commands`);
  } catch (err: any) {
    console.log('⚠️ setMyCommands 失敗:', err?.message || err);
  }
}

export { registerBotCommands, BOT_COMMANDS };
