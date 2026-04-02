const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# [PaceUp] WidgetKit extension fix";

const RUBY_INJECT = `
  ${MARKER}
  begin
    require 'xcodeproj'
    project_path = File.join(File.dirname(__FILE__), 'PaceUp.xcodeproj')
    if File.exist?(project_path)
      project = Xcodeproj::Project.open(project_path)
      changed = false
      ['PaceUpWidget', 'PaceUpLiveActivity'].each do |ext_name|
        target = project.targets.find { |t| t.name == ext_name }
        if target
          target.product_type = 'com.apple.product-type.widgetkit-extension'
          target.build_configurations.each do |config|
            s = config.build_settings
            s['SDKROOT'] = 'iphoneos'
            s['TARGETED_DEVICE_FAMILY'] = '1,2'
            s['SKIP_INSTALL'] = 'YES'
            s['ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES'] = 'NO'
            s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
            s.delete('WRAPPER_EXTENSION')
          end
          changed = true
          puts "[PaceUp] Fixed productType for target: #{ext_name}"
        end
      end
      project.save if changed
    end
  rescue => e
    puts "[PaceUp] Warning: could not patch xcodeproj: #{e.message}"
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
