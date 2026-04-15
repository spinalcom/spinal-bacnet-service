
export * from "./Interfaces";
export * from "./utils";

import { launchBacnetService } from "./utils/functions";

launchBacnetService().then(async (result) => {
    console.log("Bacnet service launched successfully.");
}).catch((err) => {
    console.error(`Failed to launch Bacnet service: ${err}`)
});


