const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# [PaceUp] CocoaPods signing fix (Xcode 14+)";

const RUBY_INJECT = `
  ${MARKER}
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['DEVELOPMENT_TEAM'] = ENV['DEVELOPMENT_TEAM'] || 'AUTO'
    end
  end
`;

module.exports = function withPodfileExtensionFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );

      if (!fs.existsSync(podfilePath)) {
        return config;
      }

      let contents = fs.readFileSync(podfilePath, "utf8");

      // Already patched
      if (contents.includes(MARKER)) {
        return config;
      }

      // Find the existing post_install block and inject before its closing 'end'
      const postInstallIdx = contents.indexOf("post_install do |installer|");
      if (postInstallIdx !== -1) {
        // Find the last 'end' after the post_install block
        const lastEnd = contents.lastIndexOf("\nend");
        if (lastEnd !== -1) {
          contents =
            contents.slice(0, lastEnd) +
            "\n" +
            RUBY_INJECT +
            "\nend" +
            contents.slice(lastEnd + 4);
        }
      } else {
        // No post_install block at all — create one
        contents +=
          "\npost_install do |installer|\n" + RUBY_INJECT + "\nend\n";
      }

      fs.writeFileSync(podfilePath, contents, "utf8");
      return config;
    },
  ]);
};
