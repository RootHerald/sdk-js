// Consumers of this package run their own Babel/Metro pipeline. We only ship
// the babel config that's used to transform the bundled `example/` Expo app
// and the Jest test suite (via ts-jest, which does NOT use Babel — kept here
// as a hint for downstream tooling like Metro / @react-native/babel-preset).
module.exports = {
  presets: [
    ['module:@react-native/babel-preset', { useTransformReactJSXExperimental: true }],
  ],
};
