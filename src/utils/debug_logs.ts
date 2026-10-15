export function printDebugLog(message?: any, ...optionalParams: any[]): void {
	const logging = process.env?.LOG_BACNET_SERVICE == "1" || process.env?.LOG_BACNET_SERVICE == "true";

	if (logging) console.log(message, ...optionalParams);
}
