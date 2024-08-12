const axios = require("axios");

const markSixReminder = async () => {
    try {
        // TODO: graphQL
        const { data } = await axios.post("https://info.cld.hkjc.com/graphql/base/", {
            operationName: "marksixDraw",
            variables: {},
            query: "fragment lotteryDrawsFragment on LotteryDraw {\n  id\n  year\n  no\n  openDate\n  closeDate\n  drawDate\n  status\n  snowballCode\n  snowballName_en\n  snowballName_ch\n  lotteryPool {\n    sell\n    status\n    totalInvestment\n    jackpot\n    unitBet\n    estimatedPrize\n    lotteryPrizes {\n      type\n      winningUnit\n      dividend\n    }\n  }\n  drawResult {\n    drawnNo\n    xDrawnNo\n  }\n}\n\nquery marksixDraw {\n  timeOffset {\n    m6\n    ts\n  }\n  lotteryDraws {\n    ...lotteryDrawsFragment\n  }\n}",
        });
        const { lotteryDraws } = data.data;
        const {
            drawDate,
            lotteryPool: { estimatedPrize, jackpot },
        } = lotteryDraws.pop();
        return `${drawDate}\n多寶 / 金多寶: ${jackpot}\n估計頭獎基金: ${estimatedPrize}`;
    } catch (error) {
        console.log(error);
        return "error";
    }
};

export { markSixReminder };
