
const { launchBacnetService } = require("./dist");


launchBacnetService().then(async (result) => {
    console.log("Bacnet service launched successfully.");
}).catch((err) => {
    console.error(`Failed to launch Bacnet service: ${err}`)
});