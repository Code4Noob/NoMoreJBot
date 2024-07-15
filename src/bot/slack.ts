require("dotenv").config();
const { App } = require("@slack/bolt");
import { markSixReminder } from "../functions/marksix";

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
});

// (async () => {
//     await app.start();
//     console.log("⚡️ Bolt app started");
// })();

// subscribe to 'app_mention' event in your App config
// need app_mentions:read and chat:write scopes
// app.event("app_mention", async ({ event, context, client, say }) => {
//     try {
//         await say({
//             blocks: [
//                 {
//                     type: "section",
//                     text: {
//                         type: "mrkdwn",
//                         text: `Thanks for the mention <@${event.user}>! Here's a button`,
//                     },
//                     accessory: {
//                         type: "button",
//                         text: {
//                             type: "plain_text",
//                             text: "Button",
//                             emoji: true,
//                         },
//                         value: "click_me_123",
//                         action_id: "first_button",
//                     },
//                 },
//             ],
//         });
//     } catch (error) {
//         console.error(error);
//     }
// });

app.command("/gg", async ({ ack, body, client, say }) => {
    try {
        await ack();
        await say({
            blocks: [
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: {
                                type: "plain_text",
                                text: ":sorry:",
                                emoji: true,
                            },
                            value: ":sorry:",
                            action_id: "sorry",
                        },
                        {
                            type: "button",
                            text: {
                                type: "plain_text",
                                text: ":wailpig1:",
                                emoji: true,
                            },
                            value: ":wailpig1:",
                            action_id: "wailpig1",
                        },
                    ],
                },
            ],
        });
    } catch (error) {
        console.error(error);
    }
});

const sayValue = async (ack, say, value) => {
    await ack();
    return say({ text: value });
};

app.action("sorry", async ({ ack, say, action: { value } }) => {
    const message = await markSixReminder();
    try {
        // await sayValue(ack, say, value);
        await ack();
        await say({ text: message })
    } catch (error) {
        console.error(error);
    }
});
app.action("wailpig1", async ({ ack, say, action: { value } }) => {
    try {
        await sayValue(ack, say, value);
    } catch (error) {
        console.error(error);
    }
});

app.message(/yoho jai/gim, async ({ say }) => {
    try {
        await say({
            text: "YOHO JAI（友和仔）是外貌可愛但擁有高科技的人工智能機械人，非常熟悉平台上的產品特性及功能！ :sorry:",
        });
    } catch (error) {
        console.error(error);
    }
});

app.command("/dice", async ({ ack, body, client, say }) => {
    try {
        const num = ["one", "two", "three", "four", "five", "six"][Math.floor(Math.random() * 6)];
        await ack();
        await say({
            blocks: [
                {
                    type: "context",
                    elements: [
                        {
                            type: "plain_text",
                            text: `:${num}:`,
                            emoji: true,
                        },
                    ],
                },
            ],
        });
    } catch (error) {
        console.error(error);
    }
});

export default app;