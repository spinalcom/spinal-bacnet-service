"use strict";
/*
 * Copyright 2022 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COV_EVENTS_NAMES = exports.SENSOR_TYPES = exports.UNITS_TYPES = exports.ObjectTypesCode = exports.PropertyNames = exports.SEGMENTATIONS = exports.APPLICATION_TAGS = exports.ENUM_DISABLE = exports.PropertyIds = exports.ObjectTypes = void 0;
const bacnetEnum_1 = __importDefault(require("./bacnetEnum"));
exports.ObjectTypes = bacnetEnum_1.default.ObjectTypes;
exports.PropertyIds = bacnetEnum_1.default.PropertyIds;
exports.ENUM_DISABLE = bacnetEnum_1.default.EnableDisable;
exports.APPLICATION_TAGS = bacnetEnum_1.default.ApplicationTags;
exports.SEGMENTATIONS = bacnetEnum_1.default.Segmentations;
exports.PropertyNames = swapObject(bacnetEnum_1.default.PropertyIds);
exports.ObjectTypesCode = swapObject(bacnetEnum_1.default.ObjectTypes);
exports.UNITS_TYPES = swapObject(bacnetEnum_1.default.UnitsId);
/*
* TYPE of item retrieved to devices
*/
exports.SENSOR_TYPES = [
    // ANALOG
    exports.ObjectTypes.OBJECT_ANALOG_INPUT,
    exports.ObjectTypes.OBJECT_ANALOG_OUTPUT,
    exports.ObjectTypes.OBJECT_ANALOG_VALUE,
    // BINARY
    exports.ObjectTypes.OBJECT_BINARY_INPUT,
    exports.ObjectTypes.OBJECT_BINARY_OUTPUT,
    exports.ObjectTypes.OBJECT_BINARY_VALUE,
    exports.ObjectTypes.OBJECT_BINARY_LIGHTING_OUTPUT,
    // MULTI_STATE
    exports.ObjectTypes.OBJECT_MULTI_STATE_INPUT,
    exports.ObjectTypes.OBJECT_MULTI_STATE_OUTPUT,
    exports.ObjectTypes.OBJECT_MULTI_STATE_VALUE,
    exports.ObjectTypes.OBJECT_BITSTRING_VALUE
    //NETWORK
];
exports.COV_EVENTS_NAMES = {
    "subscribed": "subscribed",
    "subscribe": "subscribe",
    "failed": "failed",
    "changed": "changed",
    "unsubscribe": "unsubscribe",
    "unsubscribed": "unsubscribed",
    "error": "error",
    "exit": "exit"
};
function swapObject(json) {
    const swapped = {};
    for (const key in json) {
        const value = json[key];
        swapped[value] = key;
    }
    return swapped;
}
//# sourceMappingURL=GlobalVariables.js.map