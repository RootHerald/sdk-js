//
// RootHeraldRN.swift — Swift implementation of the React Native bridge.
//
// Holds a thread-safe handle->client map and exposes async verify() to JS
// via promises. The underlying RootHeraldKit.RootHeraldClient is an actor,
// so we hop onto an async Task per request.
//

import Foundation
import RootHeraldKit

@objc(RootHeraldRN)
final class RootHeraldRN: NSObject {

  // MARK: – Handle registry

  /// Serializes access to `clients` from arbitrary RN-bridge queues.
  private let lock = NSLock()
  private var clients: [String: RootHeraldClient] = [:]

  private func client(for handle: String) -> RootHeraldClient? {
    lock.lock(); defer { lock.unlock() }
    return clients[handle]
  }

  private func setClient(_ c: RootHeraldClient, for handle: String) {
    lock.lock(); defer { lock.unlock() }
    clients[handle] = c
  }

  private func removeClient(_ handle: String) {
    lock.lock(); defer { lock.unlock() }
    clients.removeValue(forKey: handle)
  }

  // MARK: – Bridge methods

  @objc
  func create(_ apiKey: String,
              endpoint: String,
              resolver resolve: @escaping RCTPromiseResolveBlock,
              rejecter reject: @escaping RCTPromiseRejectBlock) {
    let handle = UUID().uuidString
    let c = RootHeraldClient(apiKey: apiKey, endpoint: endpoint)
    setClient(c, for: handle)
    resolve(handle)
  }

  @objc
  func setApplicationId(_ handle: String,
                        applicationId: String,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let c = client(for: handle) else {
      reject("E_INVALID_HANDLE", "Unknown client handle: \(handle)", nil)
      return
    }
    Task {
      await c.setApplicationId(applicationId)
      resolve(NSNull())
    }
  }

  @objc
  func setMockTpm(_ handle: String,
                  enabled: Bool,
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let c = client(for: handle) else {
      reject("E_INVALID_HANDLE", "Unknown client handle: \(handle)", nil)
      return
    }
    Task {
      await c.setMockTpm(enabled)
      resolve(NSNull())
    }
  }

  @objc
  func verify(_ handle: String,
              action: String,
              resolver resolve: @escaping RCTPromiseResolveBlock,
              rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let c = client(for: handle) else {
      reject("E_INVALID_HANDLE", "Unknown client handle: \(handle)", nil)
      return
    }
    Task {
      do {
        let r = try await c.verify(action: action)
        let verdict: String
        switch r.verdict {
        case .allow: verdict = "allow"
        case .warn:  verdict = "warn"
        case .deny:  verdict = "deny"
        }
        resolve([
          "verdict": verdict,
          "deviceId": r.deviceId,
          "tpmClass": r.tpmClass,
          "posture": r.postureJson,
          "reason": r.reason,
        ])
      } catch let err as RootHeraldError {
        switch err {
        case .invalidArgument:    reject("E_INVALID_ARG", "Invalid argument", err as NSError)
        case .unsupportedDevice:  reject("E_UNSUPPORTED", "Device unsupported", err as NSError)
        case .network(let msg):   reject("E_NETWORK", msg, err as NSError)
        case .server(let msg):    reject("E_SERVER", msg, err as NSError)
        case .quotaExceeded:      reject("E_QUOTA", "Quota exceeded", err as NSError)
        case .internalError(let msg): reject("E_INTERNAL", msg, err as NSError)
        }
      } catch {
        reject("E_VERIFY_FAILED", error.localizedDescription, error as NSError)
      }
    }
  }

  @objc
  func destroy(_ handle: String,
               resolver resolve: @escaping RCTPromiseResolveBlock,
               rejecter reject: @escaping RCTPromiseRejectBlock) {
    removeClient(handle)
    resolve(NSNull())
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }
}
