const path = require("path");

// Expo's workspace-root mode creates a second React Native graph in this
// monorepo because the web and terminal clients use a different React release.
process.env.EXPO_NO_METRO_WORKSPACE_ROOT = "1";

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const mobileModules = path.resolve(__dirname, "node_modules");
const workspaceModules = path.resolve(__dirname, "../../node_modules");

// Keep local phone builds deterministic on Windows and avoid worker-process
// memory spikes while Metro crawls the surrounding monorepo.
config.maxWorkers = 1;

// The repository also contains web and Ink clients on a newer React release.
// Disable parent-directory lookup so hoisted Expo packages cannot load the
// web client's React before Metro reaches these mobile-first module paths.
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [mobileModules, workspaceModules];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.join(mobileModules, "react"),
  "react-native": path.join(mobileModules, "react-native")
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return {
      type: "sourceFile",
      filePath: require.resolve(moduleName, { paths: [mobileModules] })
    };
  }

  if (moduleName === "react-native" || moduleName.startsWith("react-native/")) {
    return {
      type: "sourceFile",
      filePath: require.resolve(moduleName, { paths: [mobileModules] })
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
