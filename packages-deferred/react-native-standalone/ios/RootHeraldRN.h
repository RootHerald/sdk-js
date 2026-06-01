/*
 * RootHeraldRN.h — Objective-C++ header for the React Native bridge.
 *
 * The bridge itself is implemented in Swift (`RootHeraldRN.swift`) and
 * exported to JS via `RCT_EXTERN_MODULE` from `RootHeraldRN.mm`. This header
 * exists so non-bridge Objective-C consumers (rare, but common in mixed
 * codebases) can `#import` the type without dragging in the React headers.
 */

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

@interface RootHeraldRN : NSObject <RCTBridgeModule>
@end

NS_ASSUME_NONNULL_END
