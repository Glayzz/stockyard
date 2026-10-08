# assets/bot

The Telegram bot's two pictures, drawn by `node scripts/bot-art.mjs` in the site's own look.

| File | Size | Where it goes |
| --- | --- | --- |
| `avatar.png` | 640 x 640 | The bot's profile picture. Telegram crops it to a circle. |
| `description.png` | 640 x 360 | The picture above the bot's description, seen before pressing Start. |

To set them, open [@BotFather](https://t.me/BotFather), send `/mybots`, pick the bot and choose
**Edit Bot**: **Edit Botpic** takes `avatar.png`, **Edit Description Picture** takes
`description.png`. The profile picture can also be set through the Bot API (`setMyProfilePhoto`);
the description picture cannot.

The bot's name, description and bio are text, and the server sets the last two itself each time it
starts (`server/telegram.mjs`).
