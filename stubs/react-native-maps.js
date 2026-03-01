const React = require("react");
const { View } = require("react-native");

const Stub = () => React.createElement(View, null);
Stub.displayName = "MapStub";

module.exports = Stub;
module.exports.default = Stub;
module.exports.Marker = Stub;
module.exports.Callout = Stub;
module.exports.Circle = Stub;
module.exports.Polygon = Stub;
module.exports.Polyline = Stub;
module.exports.Overlay = Stub;
module.exports.Heatmap = Stub;
module.exports.Geojson = Stub;
module.exports.PROVIDER_DEFAULT = null;
module.exports.PROVIDER_GOOGLE = "google";
module.exports.MAP_TYPES = {};
module.exports.AnimatedRegion = class AnimatedRegion {};
