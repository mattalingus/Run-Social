const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# [PaceUp] CocoaPods bundle signing fix (Xcode 14+)";

const RUBY_INJECT = `
  ${MARKER}
  installer.pods_project.targets.each do |target|
    if target.respond_to?(:product_type) && target.product_type == "com.apple.product-type.bundle"
      target.build_configurations.each do |config|
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
      end
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
        // Find the FIRST '  end' (2-space indent) after the post_install opening —
        // that is the closing end of the post_install block itself, not the outermost end.
        const postInstallEnd = contents.indexOf("\n  end", postInstallIdx);
        if (postInstallEnd !== -1) {
          contents =
            contents.slice(0, postInstallEnd) +
            "\n" +
            RUBY_INJECT +
            contents.slice(postInstallEnd);
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
