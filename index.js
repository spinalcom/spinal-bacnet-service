
const { launchBacnetService } = require("./dist");


launchBacnetService().then(async (result) => {
    console.log(`Bacnet service launched with result: ${result}`);
}).catch((err) => {
    console.error(`Failed to launch Bacnet service: ${err}`)
});