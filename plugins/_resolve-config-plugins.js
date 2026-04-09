let configPlugins;
try {
  configPlugins = require("@expo/config-plugins");
} catch {
  configPlugins = require(
    require.resolve("@expo/config-plugins", { paths: [require.resolve("@expo/config")] })
  );
}
module.exports = configPlugins;
