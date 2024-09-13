const axios = require("axios");
import hkdayjs from "../utils/dayjs";

const markSixReminder = async () => {
    try {
        // TODO: graphQL
        const { data } = await axios.post(
            "https://info.cld.hkjc.com/graphql/base/",
            {
                operationName: "marksixDraw",
                variables: {},
                query: "fragment lotteryDrawsFragment on LotteryDraw {\n  id\n  year\n  no\n  openDate\n  closeDate\n  drawDate\n  status\n  snowballCode\n  snowballName_en\n  snowballName_ch\n  lotteryPool {\n    sell\n    status\n    totalInvestment\n    jackpot\n    unitBet\n    estimatedPrize\n    derivedFirstPrizeDiv\n    lotteryPrizes {\n      type\n      winningUnit\n      dividend\n    }\n  }\n  drawResult {\n    drawnNo\n    xDrawnNo\n  }\n}\n\nquery marksixDraw {\n  timeOffset {\n    m6\n    ts\n  }\n  lotteryDraws {\n    ...lotteryDrawsFragment\n  }\n}",
            }
        );
        const { lotteryDraws } = data.data;
        const {
            closeDate,
            lotteryPool: { estimatedPrize, jackpot, derivedFirstPrizeDiv },
        } = lotteryDraws.pop();
        const firstPrize = estimatedPrize || derivedFirstPrizeDiv;
        const over100Million = firstPrize >= 100000000 ? "!! 頭獎超過一億 !!\n" : "";
        return `${over100Million}${hkdayjs(closeDate).format(
            "DD/MM/YYYY"
        )}\n多寶 / 金多寶: ${Number(
            jackpot
        ).toLocaleString()}\n估計頭獎基金: ${Number(
            firstPrize
        ).toLocaleString()}`;
    } catch (error) {
        console.log(error);
        return "error";
    }
};

export { markSixReminder };
