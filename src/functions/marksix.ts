import { parseFromString } from "dom-parser";

const markSixReminder = async () => {
    const html = await (await fetch("https://bet.hkjc.com/marksix/index.aspx?lang=ch")).text();
    const dom = parseFromString(html);
    const snowball = dom.getElementsByClassName("snowball1");
    const result = snowball.map(
        (node, index) => `${index ? "估計頭獎基金" : "多寶 / 金多寶"}: ${node.childNodes[0].text}`
    );
    const message = result.join("\n");
    return message;
};

export { markSixReminder };
