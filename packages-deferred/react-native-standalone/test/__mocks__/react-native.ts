/**
 * Test-time mock of the bits of `react-native` we depend on.
 *
 * Tests inject their fake bridge into `NativeModules.RootHeraldRN` via the
 * `__setMockNative` helper. `Platform.select` returns its `default` branch
 * so error messages remain stable.
 */

type NativeStub = Record<string, unknown> | undefined;

export const NativeModules: { RootHeraldRN?: NativeStub } = {};

export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select<T>(spec: { ios?: T; android?: T; default?: T }): T | undefined {
    if (spec.ios) return spec.ios;
    return spec.default;
  },
};

export function __setMockNative(stub: NativeStub): void {
  NativeModules.RootHeraldRN = stub;
}

export function __resetMockNative(): void {
  NativeModules.RootHeraldRN = undefined;
}
