// CallKeep is iOS-only in DeCave (CallKit). Keep its native code out of the
// Android build; plugins/withoutAndroidCallKeep.js strips its manifest entries.
module.exports = {
  dependencies: {
    "react-native-callkeep": {
      platforms: {
        android: null,
      },
    },
  },
};
