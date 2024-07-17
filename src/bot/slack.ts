import { App } from "@slack/bolt";
import { markSixReminder } from "../functions/marksix";

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
});

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
        await say({ text: message });
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