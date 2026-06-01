// React Native autolinking config. Tells the @react-native-community/cli
// where to find the iOS Podspec and Android Gradle module so host apps
// pick them up without manual `react-native link`.
module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: __dirname + '/RootHeraldRN.podspec',
      },
      android: {
        sourceDir: './android',
        packageImportPath: 'import io.rootherald.rn.RootHeraldRNPackage;',
        packageInstance: 'new RootHeraldRNPackage()',
      },
    },
  },
};
