const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, ".env") });

const { launchBacnetService } = require("./dist");

const PORT = process.env.PORT || 47810;

launchBacnetService()
	.then(async (result) => {
		if (result) {
			console.log("Bacnet service launched. You can now use the Bacnet service.");
		}
	})
	.catch((err) => {
		console.error(`Failed to launch Bacnet service: ${err}`);
	});
