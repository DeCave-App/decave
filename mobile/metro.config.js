// Let Metro bundle the repository's shared/ modules (legal consent, bot card
// helpers) that the mobile app imports from outside its own folder.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../shared")];

module.exports = config;
