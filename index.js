const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, ".env") });

const { launchBacnetService, SERVICE_NAME } = require("./dist");

const port = process.env.PORT || 47810;

launchBacnetService(port, SERVICE_NAME)
	.then(async (result) => {
		if (result) {
			console.log("Bacnet service launched. You can now use the Bacnet service.");
		}
	})
	.catch((err) => {
		console.error(`Failed to launch Bacnet service: ${err}`);
	});
