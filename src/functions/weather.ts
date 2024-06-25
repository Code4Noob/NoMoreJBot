import axios from "axios";
import hkdayjs from "../utils/dayjs";

const weather = async () => {
    const response = await axios.get(
        "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=flw&lang=tc"
    );
    response.data.updateTime = hkdayjs(response.data.updateTime).format("DD/MM/YYYY HH:mm");
    const message = Object.values(response.data)
        .filter((value) => value)
        .join("\n");
    return message;
};

export { weather };
