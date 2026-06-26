const { launchBacnetService } = require("./dist");

launchBacnetService()
	.then(async (result) => {
		if (result) {
			console.log("Bacnet service launched. You can now use the Bacnet service.");
		}
	})
	.catch((err) => {
		console.error(`Failed to launch Bacnet service: ${err}`);
	});
