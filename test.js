
const bacstack = require('./lib/bacstack');
const utilities = require("./dist/utils/BacnetUtilities");

(async () => {
    const devices = await utilities.BacnetUtilities.discoverDevicesDynamic({
        port: 47808,
        adptimeout: 3000,
        interface: "10.8.0.16",
        mode: "bbmd",
        bbmdAddress: "10.10.117.1"
    });
    console.log('Discovered devices:', devices);
})();


// const client = new bacstack({
//     port: 47808,
//     adptimeout: 3000,
//     interface: "10.8.0.16"
// });


// client.whoIs({ address: '10.10.117.1' });

// client.readProperty("10.10.117.1", null, { type: 8, instance: 117001 }, 77, (err, value) => {
//     if (err) {
//         console.error('Error reading property:', err);
//     } else {
//         console.log('Property value:', value);
//     }
// });


// client.on('iAm', (device) => {
//     console.log('Found device:', device);
// });


// client.on('error', (err) => {
//     console.error('Error:', err);
// });


// setTimeout(() => {
//     console.log('Finished scanning for devices.');
// }, 10000);