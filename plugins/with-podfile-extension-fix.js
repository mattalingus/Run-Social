const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# [PaceUp] WidgetKit extension fix";

const POST_INSTALL_BLOCK = `
${MARKER}
post_install do |installer|
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

      if (contents.includes(MARKER)) {
        return config;
      }

      contents = contents + "\n" + POST_INSTALL_BLOCK + "\n";
      fs.writeFileSync(podfilePath, contents, "utf8");

      return config;
    },
  ]);
};
