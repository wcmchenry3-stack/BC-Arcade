module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Keeps Sentry's 340 KB attribute-name table out of the JS bundle (#2869).
      "./babel-plugins/inlineSentryConventions",
      "react-native-reanimated/plugin",
    ],
  };
};
