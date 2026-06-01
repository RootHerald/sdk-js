/*
 * RootHeraldRN.mm — React Native bridge surface for iOS.
 *
 * Implementation lives in Swift (RootHeraldRN.swift). This file uses the
 * RCT_EXTERN_MODULE family of macros to expose the Swift class to JS while
 * keeping the actual native logic in idiomatic Swift talking to the existing
 * actor-based `RootHeraldClient` from RootHeraldKit.
 *
 * Method shape mirrors the JS-side `NativeRootHeraldSpec` in
 * src/native/NativeRootHerald.ts — keep both in sync.
 */

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(RootHeraldRN, NSObject)

RCT_EXTERN_METHOD(create:(NSString *)apiKey
                  endpoint:(NSString *)endpoint
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setApplicationId:(NSString *)handle
                  applicationId:(NSString *)applicationId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setMockTpm:(NSString *)handle
                  enabled:(BOOL)enabled
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(verify:(NSString *)handle
                  action:(NSString *)action
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(destroy:(NSString *)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
